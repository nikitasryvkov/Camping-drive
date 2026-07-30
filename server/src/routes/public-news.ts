import { Router } from "express";
import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "../database.js";
import { NotFoundError, ValidationError } from "../errors.js";
import {
  toPublicImageSources,
  type PublicImageSources,
} from "../public-images.js";
import type { JsonObject } from "../validation.js";
import { fetchList, fetchOne } from "./shared.js";

const slugPattern = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;

interface PublicNewsSummaryRow extends QueryResultRow {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  coverStoragePath: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  coverVariants: JsonObject | null;
  coverImageSources?: PublicImageSources | null;
}

interface PublicNewsArticleRow extends PublicNewsSummaryRow {
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

const publicNewsSummaryColumns = `
  news.slug,
  news.title,
  news.excerpt,
  news.published_at AS "publishedAt",
  CASE WHEN cover.id IS NULL THEN NULL ELSE '/uploads/' || cover.storage_path END AS "coverImageUrl",
  cover.alt_text AS "coverImageAlt",
  cover.storage_path AS "coverStoragePath",
  cover.width AS "coverWidth",
  cover.height AS "coverHeight",
  cover.variants AS "coverVariants"
`;

export function createPublicNewsRouter(database: QueryExecutor): Router {
  const router = Router();

  router.get("/", async (request, response) => {
    const limit = parseListInteger(request.query.limit, "limit", 9, 1, 12);
    const offset = parseListInteger(request.query.offset, "offset", 0, 0, 1_000_000);
    const where = "WHERE news.status = 'published' AND news.published_at <= now()";
    const result = await fetchList<PublicNewsSummaryRow>(
      database,
      `SELECT ${publicNewsSummaryColumns}
       FROM news
       LEFT JOIN images AS cover ON cover.id = news.cover_image_id
       ${where}
       ORDER BY news.published_at DESC NULLS LAST, news.created_at DESC, news.id DESC
       LIMIT $1 OFFSET $2`,
      `SELECT count(*)::text AS total FROM news ${where}`,
      [],
      limit,
      offset,
    );
    response.set("Cache-Control", "public, max-age=0, must-revalidate");
    response.json({ ...result, data: result.data.map(withResponsiveCover) });
  });

  router.get("/:slug", async (request, response) => {
    const slug = validateSlug(request.params.slug ?? "");
    const article = await fetchOne<PublicNewsArticleRow>(
      database,
      `SELECT
         ${publicNewsSummaryColumns},
         news.content,
         news.seo_title AS "seoTitle",
         news.seo_description AS "seoDescription",
         news.updated_at AS "updatedAt"
       FROM news
       LEFT JOIN images AS cover ON cover.id = news.cover_image_id
       WHERE news.status = 'published' AND news.published_at <= now() AND news.slug = $1`,
      [slug],
      "News item",
    );
    response.set("Cache-Control", "public, max-age=0, must-revalidate");
    response.json({ data: withResponsiveCover(article) });
  });

  return router;
}

function withResponsiveCover<T extends PublicNewsSummaryRow>(
  row: T,
): Omit<T, "coverStoragePath" | "coverWidth" | "coverHeight" | "coverVariants"> & {
  coverImageSources: PublicImageSources | null;
} {
  const {
    coverStoragePath,
    coverWidth,
    coverHeight,
    coverVariants,
    ...news
  } = row;
  return {
    ...news,
    coverImageSources: coverStoragePath
      ? toPublicImageSources({
          storagePath: coverStoragePath,
          width: coverWidth,
          height: coverHeight,
          variants: coverVariants ?? {},
        })
      : null,
  };
}

function parseListInteger(
  value: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw invalidField(field, `Must be an integer between ${min} and ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw invalidField(field, `Must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function validateSlug(value: string): string {
  const slug = value;
  if (slug.length === 0 || slug.length > 200 || slug !== slug.trim() || slug !== slug.toLocaleLowerCase() || !slugPattern.test(slug)) {
    throw new NotFoundError("News item");
  }
  return slug;
}

function invalidField(field: string, message: string): ValidationError {
  return new ValidationError("The request contains invalid data", {
    fields: [{ field, message }],
  });
}
