import { createMigrationDatabase } from "./database.js";
import {
  PAGE_BLOCK_TYPES,
  validatePageBlockContent,
  validatePageContentBudget,
  type PageBlockType,
} from "./page-blocks.js";
import { parseSiteSettingsValue, SITE_SETTINGS_KEY } from "./site-settings.js";
import type { JsonObject } from "./validation.js";

export async function validateProductionData(): Promise<void> {
  const database = createMigrationDatabase();
  try {
    const result = await database.query<{ value: unknown }>(
      "SELECT value FROM site_settings WHERE key = $1 AND is_public = true LIMIT 1",
      [SITE_SETTINGS_KEY],
    );
    const setting = result.rows[0];
    if (!setting) {
      throw new Error("Public site settings are missing after migrations");
    }
    try {
      parseSiteSettingsValue(setting.value);
    } catch (error) {
      throw new Error(
        "Existing site settings are incompatible with the current schema. They were preserved; migrate them in a maintenance environment before deployment.",
        { cause: error },
      );
    }

    const publishedBlocks = await database.query<{
      pageId: string;
      slug: string;
      blockId: string | null;
      type: string | null;
      content: JsonObject | null;
    }>(
      `SELECT
         page.id::text AS "pageId",
         page.slug,
         block.id::text AS "blockId",
         block.type,
         block.content
       FROM pages AS page
       LEFT JOIN page_blocks AS block ON block.page_id = page.id
       WHERE page.status = 'published'
       ORDER BY page.id, block.position, block.id`,
    );
    const pages = new Map<string, {
      slug: string;
      blocks: Array<{ content: JsonObject }>;
      anchors: Set<string>;
    }>();
    for (const row of publishedBlocks.rows) {
      const page = pages.get(row.pageId) ?? {
        slug: row.slug,
        blocks: [],
        anchors: new Set<string>(),
      };
      if (row.blockId && row.type && row.content) {
        if (!PAGE_BLOCK_TYPES.includes(row.type as PageBlockType)) {
          throw new Error(
            `Published page "${row.slug}" contains unsupported block type "${row.type}" in block ${row.blockId}.`,
          );
        }
        try {
          validatePageBlockContent(row.type as PageBlockType, row.content);
        } catch (error) {
          throw new Error(
            `Published page "${row.slug}" contains invalid block ${row.blockId}. Correct its type-specific content before deployment.`,
            { cause: error },
          );
        }
        const anchor = row.content.anchor;
        if (typeof anchor === "string" && anchor) {
          if (page.anchors.has(anchor)) {
            throw new Error(
              `Published page "${row.slug}" contains duplicate block anchor "${anchor}".`,
            );
          }
          page.anchors.add(anchor);
        }
        page.blocks.push({ content: row.content });
      }
      pages.set(row.pageId, page);
    }
    for (const page of pages.values()) {
      try {
        validatePageContentBudget(page.blocks);
      } catch (error) {
        throw new Error(
          `Published page "${page.slug}" exceeds the production rendering budget. Reduce its blocks, collection items, or content before deployment.`,
          { cause: error },
        );
      }
    }
  } finally {
    await database.end();
  }
}
