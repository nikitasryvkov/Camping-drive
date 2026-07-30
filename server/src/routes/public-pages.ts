import { Router } from "express";
import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "../database.js";
import { NotFoundError } from "../errors.js";
import {
  toPublicImageSources,
  type PublicImageRow,
  type PublicImageSources,
} from "../public-images.js";

const slugPattern = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;
const reservedPageSlugs = new Set(["admin", "api", "assets", "healthz", "media", "news", "uploads"]);

interface PublicPageRow extends QueryResultRow {
  pageId: string;
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
  blocks: Array<{
    id: string;
    type: string;
    position: number;
    content: Record<string, unknown>;
    images: Record<string, PublicImageSources>;
  }>;
}

interface PublicPageImageRow extends QueryResultRow, PublicImageRow {
  blockId: string;
  imageId: string;
}

export function createPublicPagesRouter(database: QueryExecutor): Router {
  const router = Router();

  router.head("/:slug", async (request, response) => {
    const slug = normalizePublicSlug(request.params.slug ?? "");
    const result = await database.query(
      "SELECT 1 FROM pages WHERE slug = $1 AND status = 'published' LIMIT 1",
      [slug],
    );
    if (result.rowCount === 0) throw new NotFoundError("Published page");
    response.set("Cache-Control", "public, max-age=0, must-revalidate");
    response.status(204).send();
  });

  router.get("/:slug", async (request, response) => {
    const slug = normalizePublicSlug(request.params.slug ?? "");
    const result = await database.query<PublicPageRow>(
      `SELECT
         page.id::text AS "pageId",
         page.slug,
         page.title,
         page.seo_title AS "seoTitle",
         page.seo_description AS "seoDescription",
         page.published_at AS "publishedAt",
         page.updated_at AS "updatedAt",
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', block.id::text,
                 'type', block.type,
                 'position', block.position,
                 'content', block.content
               )
               ORDER BY block.position, block.id
             )
             FROM page_blocks AS block
             WHERE block.page_id = page.id AND block.is_visible = true
           ),
           '[]'::jsonb
         ) AS blocks
       FROM pages AS page
       WHERE page.slug = $1 AND page.status = 'published'
       LIMIT 1`,
      [slug],
    );
    const page = result.rows[0];
    if (!page) {
      throw new NotFoundError("Published page");
    }

    const imageResult = await database.query<PublicPageImageRow>(
      `SELECT
         reference.page_block_id::text AS "blockId",
         image.id::text AS "imageId",
         image.storage_path AS "storagePath",
         image.width,
         image.height,
         image.variants
       FROM page_block_images AS reference
       JOIN page_blocks AS block ON block.id = reference.page_block_id
       JOIN images AS image ON image.id = reference.image_id
       WHERE block.page_id = $1`,
      [page.pageId],
    );
    const imagesByBlock = new Map<string, Record<string, PublicImageSources>>();
    for (const image of imageResult.rows) {
      const sources = imagesByBlock.get(image.blockId) ?? {};
      sources[image.imageId] = toPublicImageSources(image);
      imagesByBlock.set(image.blockId, sources);
    }
    const { pageId: _pageId, ...publicPage } = page;
    void _pageId;
    publicPage.blocks = page.blocks.map((block) => ({
      ...block,
      images: imagesByBlock.get(block.id) ?? {},
    }));
    response.set("Cache-Control", "public, max-age=0, must-revalidate");
    response.json({ data: publicPage });
  });

  return router;
}

function normalizePublicSlug(value: string): string {
  const slug = value.trim();
  if (
    slug.length === 0 ||
    slug.length > 200 ||
    slug !== slug.toLocaleLowerCase() ||
    !slugPattern.test(slug) ||
    reservedPageSlugs.has(slug)
  ) {
    throw new NotFoundError("Published page");
  }
  return slug;
}
