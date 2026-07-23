import { Router } from "express";
import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "../database.js";
import { AppError, NotFoundError, ValidationError } from "../errors.js";
import {
  ensureAtLeastOneField,
  hasField,
  parseBody,
  parseId,
  parseOptionalQueryString,
  parsePagination,
  readDateTime,
  readEnum,
  readId,
  readString,
  rejectUnknownFields,
  type JsonObject,
} from "../validation.js";
import { buildUpdateClause, fetchList, fetchOne } from "./shared.js";

const newsStatuses = ["draft", "published"] as const;
const slugPattern = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;

interface NewsRow extends QueryResultRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImageId: string | null;
  status: (typeof newsStatuses)[number];
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NewsSummaryRow extends QueryResultRow {
  id: string;
  slug: string;
  title: string;
  status: (typeof newsStatuses)[number];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const newsSummaryColumns = `
  id::text AS "id",
  slug,
  title,
  status,
  published_at AS "publishedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const newsColumns = `
  id::text AS "id",
  slug,
  title,
  excerpt,
  content,
  cover_image_id::text AS "coverImageId",
  status,
  published_at AS "publishedAt",
  seo_title AS "seoTitle",
  seo_description AS "seoDescription",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export function createNewsRouter(database: QueryExecutor): Router {
  const router = Router();

  router.get("/", async (request, response) => {
    const query = request.query as JsonObject;
    const { limit, offset } = parsePagination(query);
    const status = parseOptionalQueryString(query.status, "status", 20);
    const search = parseOptionalQueryString(query.search, "search", 200);
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (status) {
      if (!newsStatuses.includes(status as (typeof newsStatuses)[number])) {
        throw new ValidationError("The request contains invalid data", {
          fields: [{ field: "status", message: `Must be one of: ${newsStatuses.join(", ")}` }],
        });
      }
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    if (search) {
      values.push(`%${escapeLike(search)}%`);
      conditions.push(`(title ILIKE $${values.length} ESCAPE '\\' OR excerpt ILIKE $${values.length} ESCAPE '\\' OR slug ILIKE $${values.length} ESCAPE '\\')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await fetchList<NewsSummaryRow>(
      database,
      `SELECT ${newsSummaryColumns} FROM news ${where}
       ORDER BY published_at DESC NULLS LAST, created_at DESC, id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      `SELECT count(*)::text AS total FROM news ${where}`,
      values,
      limit,
      offset,
    );
    response.json(result);
  });

  router.get("/slug/:slug", async (request, response) => {
    const slug = validateSlug(request.params.slug ?? "", "slug");
    const item = await fetchOne<NewsRow>(
      database,
      `SELECT ${newsColumns} FROM news WHERE slug = $1`,
      [slug],
      "News item",
    );
    response.json({ data: item });
  });

  router.get("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const item = await getNewsItem(database, id);
    response.json({ data: item });
  });

  router.post("/", async (request, response) => {
    const input = parseNewsInput(request.body, true);
    const status = input.status ?? "draft";
    const excerpt = input.excerpt ?? "";
    const content = input.content ?? "";
    validatePublication(status, excerpt, content);
    const result = await database.query<NewsRow>(
      `INSERT INTO news (
         slug, title, excerpt, content, cover_image_id, status,
         published_at, seo_title, seo_description
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${newsColumns}`,
      [
        input.slug,
        input.title,
        excerpt,
        content,
        input.coverImageId ?? null,
        status,
        input.publishedAt ?? null,
        input.seoTitle ?? null,
        input.seoDescription ?? null,
      ],
    );
    response.status(201).json({ data: result.rows[0] });
  });

  router.patch("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const input = parseNewsInput(request.body, false);
    const current = await getNewsItem(database, id);
    validatePublication(
      input.status ?? current.status,
      input.excerpt ?? current.excerpt,
      input.content ?? current.content,
    );
    const update = buildUpdateClause({
      slug: input.slug,
      title: input.title,
      excerpt: input.excerpt,
      content: input.content,
      cover_image_id: input.coverImageId,
      status: input.status,
      published_at: input.publishedAt,
      seo_title: input.seoTitle,
      seo_description: input.seoDescription,
    });
    const result = await database.query<NewsRow>(
      `UPDATE news
       SET ${update.clause}
       WHERE id = $${update.values.length + 1}
         AND updated_at = $${update.values.length + 2}::timestamptz
       RETURNING ${newsColumns}`,
      [...update.values, id, input.expectedUpdatedAt],
    );
    const item = result.rows[0];
    if (!item) {
      throw new AppError(409, "EDIT_CONFLICT", "News item was changed in another browser session");
    }
    response.json({ data: item });
  });

  router.delete("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const expectedUpdatedAt = readDateTime(
      { expectedUpdatedAt: request.query.expectedUpdatedAt },
      "expectedUpdatedAt",
      { required: true },
    )!;
    const result = await database.query(
      "DELETE FROM news WHERE id = $1 AND updated_at = $2::timestamptz",
      [id, expectedUpdatedAt],
    );

    if (result.rowCount === 0) {
      const exists = await database.query("SELECT 1 FROM news WHERE id = $1", [id]);
      if (exists.rowCount === 0) throw new NotFoundError("News item");
      throw new AppError(409, "EDIT_CONFLICT", "News item was changed in another browser session");
    }

    response.status(204).send();
  });

  return router;
}

async function getNewsItem(database: QueryExecutor, id: string): Promise<NewsRow> {
  return fetchOne<NewsRow>(
    database,
    `SELECT ${newsColumns} FROM news WHERE id = $1`,
    [id],
    "News item",
  );
}

function parseNewsInput(bodyValue: unknown, create: boolean) {
  const body = parseBody(bodyValue);
  rejectUnknownFields(body, [
    "slug",
    "title",
    "excerpt",
    "content",
    "coverImageId",
    "status",
    "publishedAt",
    "seoTitle",
    "seoDescription",
    "expectedUpdatedAt",
  ]);
  ensureAtLeastOneField(body);

  return {
    slug: hasField(body, "slug")
      ? validateSlug(readString(body, "slug", { required: true, maxLength: 200 })!, "slug")
      : create
        ? requiredField("slug")
        : undefined,
    title: readString(body, "title", { required: create, maxLength: 300 }),
    excerpt: readString(body, "excerpt", { allowEmpty: true, maxLength: 1000 }),
    content: readString(body, "content", {
      allowEmpty: true,
      normalize: (value) => value,
      maxLength: 1_000_000,
    }),
    coverImageId: readId(body, "coverImageId", { nullable: true }),
    status: readEnum(body, "status", newsStatuses),
    publishedAt: readDateTime(body, "publishedAt", { nullable: true }),
    seoTitle: readString(body, "seoTitle", { nullable: true, maxLength: 300 }),
    seoDescription: readString(body, "seoDescription", { nullable: true, maxLength: 500 }),
    expectedUpdatedAt: readDateTime(body, "expectedUpdatedAt", { required: !create })!,
  };
}

function validatePublication(
  status: (typeof newsStatuses)[number],
  excerpt: string,
  content: string,
): void {
  if (status !== "published") return;
  const fields: Array<{ field: string; message: string }> = [];
  if (excerpt.trim().length === 0) fields.push({ field: "excerpt", message: "Must not be empty when published" });
  if (content.trim().length === 0) fields.push({ field: "content", message: "Must not be empty when published" });
  if (fields.length > 0) {
    throw new ValidationError("Published news must contain an excerpt and content", { fields });
  }
}

function validateSlug(value: string, field: string): string {
  const slug = value.trim();

  if (slug.length === 0 || slug.length > 200 || slug !== slug.toLocaleLowerCase() || !slugPattern.test(slug)) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field, message: "Use lowercase letters, numbers, and single hyphens" }],
    });
  }

  return slug;
}

function requiredField(field: string): never {
  throw new ValidationError("The request contains invalid data", {
    fields: [{ field, message: "Field is required" }],
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
