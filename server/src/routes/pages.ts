import { Router } from "express";
import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "../database.js";
import { AppError, NotFoundError, ValidationError } from "../errors.js";
import {
  MAX_BUILDER_PAYLOAD_BYTES,
} from "../../../shared/page-limits.js";
import {
  MAX_PAGE_BLOCKS,
  PAGE_BLOCK_TYPES,
  validatePageBlockContent,
  validatePageContentBudget,
  type PageBlockType,
} from "../page-blocks.js";
import {
  ensureAtLeastOneField,
  hasField,
  parseBody,
  parseId,
  parseOptionalQueryString,
  parsePagination,
  readBoolean,
  readDateTime,
  readEnum,
  readInteger,
  readId,
  readObject,
  readString,
  rejectUnknownFields,
  type JsonObject,
} from "../validation.js";
import { buildUpdateClause, fetchList, fetchOne } from "./shared.js";

const pageStatuses = ["draft", "published"] as const;
const slugPattern = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;
const reservedPageSlugs = new Set(["admin", "api", "assets", "healthz", "media", "news", "uploads"]);

interface PageRow extends QueryResultRow {
  id: string;
  slug: string;
  title: string;
  status: (typeof pageStatuses)[number];
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BlockRow extends QueryResultRow {
  id: string;
  pageId: string;
  type: string;
  position: number;
  isVisible: boolean;
  content: JsonObject;
  createdAt: string;
  updatedAt: string;
}

const pageColumns = `
  id::text AS "id",
  slug,
  title,
  status,
  seo_title AS "seoTitle",
  seo_description AS "seoDescription",
  published_at AS "publishedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const blockColumns = `
  id::text AS "id",
  page_id::text AS "pageId",
  type,
  position,
  is_visible AS "isVisible",
  content,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export function createPagesRouter(database: QueryExecutor): Router {
  const router = Router();

  router.get("/", async (request, response) => {
    const query = request.query as JsonObject;
    const { limit, offset } = parsePagination(query);
    const status = parseOptionalQueryString(query.status, "status", 20);
    const search = parseOptionalQueryString(query.search, "search", 200);
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (status) {
      if (!pageStatuses.includes(status as (typeof pageStatuses)[number])) {
        throw new ValidationError("The request contains invalid data", {
          fields: [{ field: "status", message: `Must be one of: ${pageStatuses.join(", ")}` }],
        });
      }
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    if (search) {
      values.push(`%${escapeLike(search)}%`);
      conditions.push(`(title ILIKE $${values.length} ESCAPE '\\' OR slug ILIKE $${values.length} ESCAPE '\\')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await fetchList<PageRow>(
      database,
      `SELECT ${pageColumns} FROM pages ${where} ORDER BY updated_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      `SELECT count(*)::text AS total FROM pages ${where}`,
      values,
      limit,
      offset,
    );
    response.json(result);
  });

  router.get("/slug/:slug", async (request, response) => {
    const slug = validateSlug(request.params.slug ?? "", "slug");
    const page = await fetchOne<PageRow>(
      database,
      `SELECT ${pageColumns} FROM pages WHERE slug = $1`,
      [slug],
      "Page",
    );
    const blocks = await getBlocks(database, page.id);
    response.json({ data: { ...page, blocks } });
  });

  router.get("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const page = await getPage(database, id);
    const blocks = await getBlocks(database, id);
    response.json({ data: { ...page, blocks } });
  });

  router.post("/", async (request, response) => {
    const input = parsePageInput(request.body, true);
    const result = await database.query<PageRow>(
      `INSERT INTO pages (slug, title, status, seo_title, seo_description, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${pageColumns}`,
      [
        input.slug,
        input.title,
        input.status ?? "draft",
        input.seoTitle ?? null,
        input.seoDescription ?? null,
        input.publishedAt ?? null,
      ],
    );
    response.status(201).json({ data: { ...result.rows[0]!, blocks: [] } });
  });

  router.put("/:id/builder", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const input = parseBuilderInput(request.body);
    if (!database.connect) {
      throw new Error("Saving a page builder requires a transactional database connection");
    }
    const client = await database.connect();
    const executor = client as unknown as QueryExecutor;

    try {
      await client.query("BEGIN");
      const pageResult = await executor.query<{ id: string; isCurrent: boolean }>(
        `SELECT id::text AS id, (updated_at = $2::timestamptz) AS "isCurrent"
         FROM pages
         WHERE id = $1
         FOR UPDATE`,
        [id, input.expectedUpdatedAt],
      );
      const lockedPage = pageResult.rows[0];
      if (!lockedPage) throw new NotFoundError("Page");
      if (!lockedPage.isCurrent) {
        throw new AppError(409, "EDIT_CONFLICT", "Page was changed in another browser session");
      }

      const currentResult = await executor.query<{ id: string; position: number }>(
        `SELECT id::text AS id, position
         FROM page_blocks
         WHERE page_id = $1
         ORDER BY position, id
         FOR UPDATE`,
        [id],
      );
      const currentIds = new Set(currentResult.rows.map((row) => row.id));
      const submittedIds = input.blocks.flatMap((block) => block.id ? [block.id] : []);
      const unknownId = submittedIds.find((blockId) => !currentIds.has(blockId));
      if (unknownId) {
        throw new ValidationError("The request contains a block that does not belong to the page", {
          fields: [{ field: "blocks", message: `Block ${unknownId} does not belong to this page` }],
        });
      }

      const deletedIds = [...currentIds].filter((blockId) => !submittedIds.includes(blockId));
      if (deletedIds.length > 0) {
        await executor.query(
          "DELETE FROM page_blocks WHERE page_id = $1 AND id = ANY($2::bigint[])",
          [id, deletedIds],
        );
      }

      if (submittedIds.length > 0) {
        const highestPosition = Math.max(0, ...currentResult.rows.map((row) => row.position));
        await executor.query(
          "UPDATE page_blocks SET position = position + $2 WHERE page_id = $1",
          [id, highestPosition + input.blocks.length + 1],
        );
      }

      const serializedBlocks = JSON.stringify(input.blocks.map((block, position) => ({
        id: block.id ?? null,
        type: block.type,
        position,
        isVisible: block.isVisible,
        content: block.content,
      })));
      await executor.query(
        `WITH submitted AS (
           SELECT *
           FROM jsonb_to_recordset($2::jsonb) AS item(
             id bigint,
             type text,
             position integer,
             "isVisible" boolean,
             content jsonb
           )
         )
         UPDATE page_blocks AS block
         SET type = submitted.type,
             position = submitted.position,
             is_visible = submitted."isVisible",
             content = submitted.content
         FROM submitted
         WHERE block.page_id = $1 AND block.id = submitted.id`,
        [id, serializedBlocks],
      );
      await executor.query(
        `WITH submitted AS (
           SELECT *
           FROM jsonb_to_recordset($2::jsonb) AS item(
             id bigint,
             type text,
             position integer,
             "isVisible" boolean,
             content jsonb
           )
         )
         INSERT INTO page_blocks (page_id, type, position, is_visible, content)
         SELECT $1, type, position, "isVisible", content
         FROM submitted
         WHERE id IS NULL
         ORDER BY position`,
        [id, serializedBlocks],
      );
      const blocks = await getBlocks(executor, id);
      await syncBuilderImageReferences(executor, blocks, input.blocks);

      const page = await fetchOne<PageRow>(
        executor,
        `UPDATE pages
         SET slug = $1, title = $2, status = $3, seo_title = $4, seo_description = $5
         WHERE id = $6
         RETURNING ${pageColumns}`,
        [input.slug, input.title, input.status, input.seoTitle, input.seoDescription, id],
        "Page",
      );
      await client.query("COMMIT");
      response.json({ data: { ...page, blocks } });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  });

  router.patch("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const input = parsePageInput(request.body, false);
    if (input.status === "published") {
      await validateStoredPageBudget(database, id);
    }
    const update = buildUpdateClause({
      slug: input.slug,
      title: input.title,
      status: input.status,
      seo_title: input.seoTitle,
      seo_description: input.seoDescription,
      published_at: input.publishedAt,
    });
    const result = await database.query<PageRow>(
      `UPDATE pages SET ${update.clause}
       WHERE id = $${update.values.length + 1}
         AND updated_at = $${update.values.length + 2}::timestamptz
       RETURNING ${pageColumns}`,
      [...update.values, id, input.expectedUpdatedAt],
    );
    const page = result.rows[0];
    if (!page) {
      const exists = await database.query("SELECT 1 FROM pages WHERE id = $1", [id]);
      if (exists.rowCount === 0) throw new NotFoundError("Page");
      throw new AppError(409, "EDIT_CONFLICT", "Page was changed in another browser session");
    }
    response.json({ data: page });
  });

  router.delete("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const expectedUpdatedAt = readExpectedUpdatedAt(request.query.expectedUpdatedAt);
    const result = await database.query(
      "DELETE FROM pages WHERE id = $1 AND updated_at = $2::timestamptz",
      [id, expectedUpdatedAt],
    );

    if (result.rowCount === 0) {
      const exists = await database.query("SELECT 1 FROM pages WHERE id = $1", [id]);
      if (exists.rowCount === 0) throw new NotFoundError("Page");
      throw new AppError(409, "EDIT_CONFLICT", "Page was changed in another browser session");
    }

    response.status(204).send();
  });

  router.get("/:pageId/blocks", async (request, response) => {
    const pageId = parseId(request.params.pageId ?? "", "pageId");
    await getPage(database, pageId);
    response.json({ data: await getBlocks(database, pageId) });
  });

  router.post("/:pageId/blocks", async (request, response) => {
    const pageId = parseId(request.params.pageId ?? "", "pageId");
    const input = parseBlockInput(request.body, true);
    const imageIds = extractBlockImageIds(input.content);
    const client = database.connect ? await database.connect() : undefined;
    const executor = (client ?? database) as QueryExecutor;

    try {
      if (client) {
        await client.query("BEGIN");
      }

      await lockCurrentPage(executor, pageId, input.expectedUpdatedAt);
      await ensureUniquePageBlockAnchor(executor, pageId, input.content!);

      let position = input.position;
      if (position === undefined) {
        const positionResult = await executor.query<{ position: number }>(
          "SELECT COALESCE(max(position) + 1, 0)::integer AS position FROM page_blocks WHERE page_id = $1",
          [pageId],
        );
        position = positionResult.rows[0]!.position;
      }

      const result = await executor.query<BlockRow>(
        `INSERT INTO page_blocks (page_id, type, position, is_visible, content)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${blockColumns}`,
        [pageId, input.type, position, input.isVisible ?? true, input.content],
      );
      const block = result.rows[0]!;
      await validateStoredPageBudget(executor, pageId);
      await syncBlockImageReferences(executor, block.id, imageIds);
      const version = await touchPage(executor, pageId);

      if (client) {
        await client.query("COMMIT");
      }
      response.status(201).json({ data: block, pageUpdatedAt: version });
    } catch (error) {
      if (client) {
        await rollback(client);
      }
      throw error;
    } finally {
      client?.release();
    }
  });

  router.put("/:pageId/blocks/reorder", async (request, response) => {
    const pageId = parseId(request.params.pageId ?? "", "pageId");
    const { blockIds, expectedUpdatedAt } = parseBlockOrder(request.body);
    const client = database.connect ? await database.connect() : undefined;
    const executor = (client ?? database) as QueryExecutor;

    try {
      if (client) await client.query("BEGIN");

      await lockCurrentPage(executor, pageId, expectedUpdatedAt);

      const currentResult = await executor.query<{ id: string; position: number }>(
        `SELECT id::text AS id, position
         FROM page_blocks
         WHERE page_id = $1
         ORDER BY position, id
         FOR UPDATE`,
        [pageId],
      );
      const currentIds = currentResult.rows.map((row) => row.id);
      const requestedIds = new Set(blockIds);
      if (
        currentIds.length !== blockIds.length ||
        currentIds.some((id) => !requestedIds.has(id))
      ) {
        throw new ValidationError("Block order must contain every page block exactly once", {
          fields: [{ field: "blockIds", message: "Does not match the page block set" }],
        });
      }

      if (blockIds.length > 0) {
        const highestPosition = Math.max(...currentResult.rows.map((row) => row.position));
        await executor.query(
          "UPDATE page_blocks SET position = position + $2 WHERE page_id = $1",
          [pageId, highestPosition + 1],
        );
        await executor.query(
          `UPDATE page_blocks AS block
           SET position = (ordered.ordinal - 1)::integer
           FROM unnest($2::bigint[]) WITH ORDINALITY AS ordered(id, ordinal)
           WHERE block.page_id = $1 AND block.id = ordered.id`,
          [pageId, blockIds],
        );
      }

      const blocks = await getBlocks(executor, pageId);
      const version = await touchPage(executor, pageId);
      if (client) await client.query("COMMIT");
      response.json({ data: blocks, pageUpdatedAt: version });
    } catch (error) {
      if (client) await rollback(client);
      throw error;
    } finally {
      client?.release();
    }
  });

  router.get("/:pageId/blocks/:blockId", async (request, response) => {
    const pageId = parseId(request.params.pageId ?? "", "pageId");
    const blockId = parseId(request.params.blockId ?? "", "blockId");
    const block = await getBlock(database, pageId, blockId);
    response.json({ data: block });
  });

  router.patch("/:pageId/blocks/:blockId", async (request, response) => {
    const pageId = parseId(request.params.pageId ?? "", "pageId");
    const blockId = parseId(request.params.blockId ?? "", "blockId");
    const input = parseBlockInput(request.body, false);
    const update = buildUpdateClause({
      type: input.type,
      position: input.position,
      is_visible: input.isVisible,
      content: input.content,
    });
    const imageIds = input.content ? extractBlockImageIds(input.content) : undefined;
    const client = database.connect ? await database.connect() : undefined;
    const executor = (client ?? database) as QueryExecutor;

    try {
      if (client) {
        await client.query("BEGIN");
      }

      await lockCurrentPage(executor, pageId, input.expectedUpdatedAt);
      const currentBlock = await getBlock(executor, pageId, blockId);
      if (input.type || input.content) {
        const candidateType = input.type ?? currentBlock.type;
        if (!PAGE_BLOCK_TYPES.includes(candidateType as PageBlockType)) {
          throw new ValidationError("The request contains an unsupported page block type");
        }
        validatePageBlockContent(
          candidateType as PageBlockType,
          input.content ?? currentBlock.content,
        );
      }
      await ensureUniquePageBlockAnchor(executor, pageId, input.content ?? currentBlock.content, blockId);

      const block = await fetchOne<BlockRow>(
        executor,
        `UPDATE page_blocks SET ${update.clause}
         WHERE id = $${update.values.length + 1} AND page_id = $${update.values.length + 2}
         RETURNING ${blockColumns}`,
        [...update.values, blockId, pageId],
        "Page block",
      );

      await validateStoredPageBudget(executor, pageId);
      if (imageIds) {
        await syncBlockImageReferences(executor, block.id, imageIds);
      }
      const version = await touchPage(executor, pageId);

      if (client) {
        await client.query("COMMIT");
      }
      response.json({ data: block, pageUpdatedAt: version });
    } catch (error) {
      if (client) {
        await rollback(client);
      }
      throw error;
    } finally {
      client?.release();
    }
  });

  router.delete("/:pageId/blocks/:blockId", async (request, response) => {
    const pageId = parseId(request.params.pageId ?? "", "pageId");
    const blockId = parseId(request.params.blockId ?? "", "blockId");
    const expectedUpdatedAt = readExpectedUpdatedAt(request.query.expectedUpdatedAt);
    const client = database.connect ? await database.connect() : undefined;
    const executor = (client ?? database) as QueryExecutor;
    try {
      if (client) await client.query("BEGIN");
      await lockCurrentPage(executor, pageId, expectedUpdatedAt);
      const result = await executor.query(
        "DELETE FROM page_blocks WHERE id = $1 AND page_id = $2",
        [blockId, pageId],
      );
      if (result.rowCount === 0) throw new NotFoundError("Page block");
      const version = await touchPage(executor, pageId);
      if (client) await client.query("COMMIT");
      response.set("X-Page-Updated-At", version);
      response.status(204).send();
    } catch (error) {
      if (client) await rollback(client);
      throw error;
    } finally {
      client?.release();
    }
  });

  return router;
}

async function getPage(database: QueryExecutor, id: string): Promise<PageRow> {
  return fetchOne<PageRow>(
    database,
    `SELECT ${pageColumns} FROM pages WHERE id = $1`,
    [id],
    "Page",
  );
}

async function getBlocks(database: QueryExecutor, pageId: string): Promise<BlockRow[]> {
  const result = await database.query<BlockRow>(
    `SELECT ${blockColumns} FROM page_blocks WHERE page_id = $1 ORDER BY position, id`,
    [pageId],
  );
  return result.rows;
}

async function getBlock(
  database: QueryExecutor,
  pageId: string,
  blockId: string,
): Promise<BlockRow> {
  return fetchOne<BlockRow>(
    database,
    `SELECT ${blockColumns} FROM page_blocks WHERE id = $1 AND page_id = $2`,
    [blockId, pageId],
    "Page block",
  );
}

function parsePageInput(bodyValue: unknown, create: boolean) {
  const body = parseBody(bodyValue);
  rejectUnknownFields(body, [
    "slug",
    "title",
    "status",
    "seoTitle",
    "seoDescription",
    "publishedAt",
    ...(create ? [] : ["expectedUpdatedAt"]),
  ]);
  ensureAtLeastOneField(body);
  if (!create && Object.keys(body).every((key) => key === "expectedUpdatedAt")) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "body", message: "At least one page field must be changed" }],
    });
  }

  return {
    slug: hasField(body, "slug")
      ? validateSlug(readString(body, "slug", { required: true, maxLength: 200 })!, "slug")
      : create
        ? requiredField("slug")
        : undefined,
    title: readString(body, "title", { required: create, maxLength: 300 }),
    status: readEnum(body, "status", pageStatuses),
    seoTitle: readString(body, "seoTitle", { nullable: true, maxLength: 300 }),
    seoDescription: readString(body, "seoDescription", { nullable: true, maxLength: 500 }),
    publishedAt: readDateTime(body, "publishedAt", { nullable: true }),
    expectedUpdatedAt: create
      ? undefined
      : readDateTime(body, "expectedUpdatedAt", { required: true })!,
  };
}

function parseBlockInput(bodyValue: unknown, create: boolean) {
  const body = parseBody(bodyValue);
  rejectUnknownFields(body, ["type", "position", "isVisible", "content", "expectedUpdatedAt"]);
  ensureAtLeastOneField(body);
  if (!create && Object.keys(body).every((field) => field === "expectedUpdatedAt")) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "body", message: "At least one block field must be changed" }],
    });
  }
  const type = readEnum(body, "type", PAGE_BLOCK_TYPES, { required: create });
  const content = readObject(body, "content", { required: create });
  if (type && content) validatePageBlockContent(type, content);
  return {
    type,
    position: readInteger(body, "position", { min: 0, max: 1_000_000 }),
    isVisible: readBoolean(body, "isVisible"),
    content,
    expectedUpdatedAt: readDateTime(body, "expectedUpdatedAt", { required: true })!,
  };
}

function parseBuilderInput(bodyValue: unknown) {
  if (Buffer.byteLength(JSON.stringify(bodyValue), "utf8") > MAX_BUILDER_PAYLOAD_BYTES) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "body", message: "Page builder data must not exceed 2 MiB" }],
    });
  }
  const body = parseBody(bodyValue);
  rejectUnknownFields(body, [
    "slug",
    "title",
    "status",
    "seoTitle",
    "seoDescription",
    "expectedUpdatedAt",
    "blocks",
  ]);
  const rawBlocks = body.blocks;
  if (!Array.isArray(rawBlocks) || rawBlocks.length > MAX_PAGE_BLOCKS) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "blocks", message: `Must be an array with no more than ${MAX_PAGE_BLOCKS} blocks` }],
    });
  }

  const blocks = rawBlocks.map((rawBlock, index) => {
    const block = parseBody(rawBlock);
    rejectUnknownFields(block, ["id", "type", "isVisible", "content"]);
    const type = readEnum(block, "type", PAGE_BLOCK_TYPES, { required: true })!;
    const content = readObject(block, "content", { required: true })!;
    validatePageBlockContent(type, content);
    return {
      id: readId(block, "id"),
      type,
      isVisible: readBoolean(block, "isVisible", { required: true })!,
      content,
      index,
    };
  });
  const ids = blocks.flatMap((block) => block.id ? [block.id] : []);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "blocks", message: "Must not contain duplicate block IDs" }],
    });
  }
  const anchors = blocks.flatMap((block) => {
    const anchor = block.content.anchor;
    return typeof anchor === "string" && anchor ? [anchor] : [];
  });
  if (new Set(anchors).size !== anchors.length) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "blocks", message: "Block HTML anchors must be unique within a page" }],
    });
  }
  validatePageContentBudget(blocks);

  return {
    slug: validateSlug(readString(body, "slug", { required: true, maxLength: 200 })!, "slug"),
    title: readString(body, "title", { required: true, maxLength: 300 })!,
    status: readEnum(body, "status", pageStatuses, { required: true })!,
    seoTitle: readString(body, "seoTitle", { nullable: true, maxLength: 300 }) ?? null,
    seoDescription: readString(body, "seoDescription", { nullable: true, maxLength: 500 }) ?? null,
    expectedUpdatedAt: readDateTime(body, "expectedUpdatedAt", { required: true })!,
    blocks,
  };
}

async function ensureUniquePageBlockAnchor(
  database: QueryExecutor,
  pageId: string,
  content: JsonObject,
  excludedBlockId?: string,
): Promise<void> {
  const anchor = content.anchor;
  if (typeof anchor !== "string" || anchor === "") return;

  const result = await database.query(
    `SELECT id
     FROM page_blocks
     WHERE page_id = $1
       AND content->>'anchor' = $2
       AND ($3::bigint IS NULL OR id <> $3::bigint)
     LIMIT 1`,
    [pageId, anchor, excludedBlockId ?? null],
  );
  if (result.rowCount) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "content.anchor", message: "Must be unique within the page" }],
    });
  }
}

async function validateStoredPageBudget(database: QueryExecutor, pageId: string): Promise<void> {
  const blocks = await getBlocks(database, pageId);
  validatePageContentBudget(blocks);
}

function parseBlockOrder(bodyValue: unknown): { blockIds: string[]; expectedUpdatedAt: string } {
  const body = parseBody(bodyValue);
  rejectUnknownFields(body, ["blockIds", "expectedUpdatedAt"]);
  const value = body.blockIds;
  if (!Array.isArray(value)) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "blockIds", message: "Must be an array of block IDs" }],
    });
  }

  const blockIds = value.map((item, index) => {
    if (typeof item !== "string" && typeof item !== "number") {
      throw new ValidationError("The request contains invalid data", {
        fields: [{ field: `blockIds[${index}]`, message: "Must be a valid block ID" }],
      });
    }
    return parseId(String(item), `blockIds[${index}]`);
  });
  if (new Set(blockIds).size !== blockIds.length) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "blockIds", message: "Must not contain duplicate IDs" }],
    });
  }
  return {
    blockIds,
    expectedUpdatedAt: readDateTime(body, "expectedUpdatedAt", { required: true })!,
  };
}

async function lockCurrentPage(
  database: QueryExecutor,
  pageId: string,
  expectedUpdatedAt: string,
): Promise<void> {
  const result = await database.query<{ isCurrent: boolean }>(
    `SELECT (updated_at = $2::timestamptz) AS "isCurrent"
     FROM pages
     WHERE id = $1
     FOR UPDATE`,
    [pageId, expectedUpdatedAt],
  );
  const page = result.rows[0];
  if (!page) throw new NotFoundError("Page");
  if (!page.isCurrent) {
    throw new AppError(409, "EDIT_CONFLICT", "Page was changed in another browser session");
  }
}

async function touchPage(database: QueryExecutor, pageId: string): Promise<string> {
  const result = await database.query<{ updatedAt: string }>(
    `UPDATE pages SET updated_at = now() WHERE id = $1 RETURNING updated_at AS "updatedAt"`,
    [pageId],
  );
  return result.rows[0]!.updatedAt;
}

function readExpectedUpdatedAt(value: unknown): string {
  return readDateTime({ expectedUpdatedAt: value }, "expectedUpdatedAt", { required: true })!;
}

function extractBlockImageIds(content: JsonObject | undefined): string[] {
  if (!content) {
    return [];
  }

  const ids = new Set<string>();
  const pending: Array<{ value: unknown; path: string }> = [{ value: content, path: "content" }];

  while (pending.length > 0) {
    const current = pending.pop()!;

    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => {
        pending.push({ value, path: `${current.path}[${index}]` });
      });
      continue;
    }

    if (!current.value || typeof current.value !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(current.value)) {
      const path = `${current.path}.${key}`;
      const normalizedKey = key.toLowerCase();

      if (normalizedKey.endsWith("imageids")) {
        if (!Array.isArray(value)) {
          throw blockImageIdError(path, "Must be an array of image IDs");
        }
        value.forEach((item, index) => ids.add(parseBlockImageId(item, `${path}[${index}]`)));
      } else if (normalizedKey.endsWith("imageid")) {
        if (value !== null) {
          ids.add(parseBlockImageId(value, path));
        }
      } else {
        pending.push({ value, path });
      }
    }
  }

  return [...ids];
}

function parseBlockImageId(value: unknown, path: string): string {
  try {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
      return parseId(String(value), path);
    }

    if (typeof value === "string") {
      return parseId(value, path);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw blockImageIdError(path, "Must be a valid image ID");
    }
    throw error;
  }

  throw blockImageIdError(path, "Must be a valid image ID");
}

function blockImageIdError(path: string, message: string): ValidationError {
  return new ValidationError("The request contains invalid data", {
    fields: [{ field: path, message }],
  });
}

async function syncBlockImageReferences(
  database: QueryExecutor,
  blockId: string,
  imageIds: string[],
): Promise<void> {
  await database.query(
    `DELETE FROM page_block_images
     WHERE page_block_id = $1
       AND NOT (image_id = ANY($2::bigint[]))`,
    [blockId, imageIds],
  );

  if (imageIds.length > 0) {
    await database.query(
      `INSERT INTO page_block_images (page_block_id, image_id)
       SELECT $1::bigint, refs.image_id
       FROM unnest($2::bigint[]) AS refs(image_id)
       ON CONFLICT (page_block_id, image_id) DO NOTHING`,
      [blockId, imageIds],
    );
  }
}

async function syncBuilderImageReferences(
  database: QueryExecutor,
  blocks: BlockRow[],
  inputs: Array<{ content: JsonObject }>,
): Promise<void> {
  const blockIds = blocks.map((block) => block.id);
  if (blockIds.length === 0) return;

  await database.query(
    "DELETE FROM page_block_images WHERE page_block_id = ANY($1::bigint[])",
    [blockIds],
  );

  const references = blocks.flatMap((block) =>
    extractBlockImageIds(inputs[block.position]?.content).map((imageId) => ({
      blockId: block.id,
      imageId,
    })),
  );
  if (references.length === 0) return;

  await database.query(
    `INSERT INTO page_block_images (page_block_id, image_id)
     SELECT refs.page_block_id, refs.image_id
     FROM unnest($1::bigint[], $2::bigint[]) AS refs(page_block_id, image_id)
     ON CONFLICT (page_block_id, image_id) DO NOTHING`,
    [references.map((reference) => reference.blockId), references.map((reference) => reference.imageId)],
  );
}

async function rollback(client: { query(text: string): Promise<unknown> }): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error("Failed to roll back page block transaction", rollbackError);
  }
}

function validateSlug(value: string, field: string): string {
  const slug = value.trim();

  if (slug.length === 0 || slug.length > 200 || slug !== slug.toLocaleLowerCase() || !slugPattern.test(slug) || reservedPageSlugs.has(slug)) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field, message: "Use an available lowercase slug with letters, numbers, and single hyphens" }],
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
