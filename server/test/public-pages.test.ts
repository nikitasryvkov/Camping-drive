import assert from "node:assert/strict";
import { describe, it } from "node:test";

import express from "express";

import type { QueryExecutor } from "../src/database.js";
import { errorHandler } from "../src/errors.js";
import { createPublicPagesRouter } from "../src/routes/public-pages.js";

describe("public pages API", () => {
  it("returns the published page selected by slug without authentication", async () => {
    const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const fakeDatabase = {
      async query(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("page_block_images AS reference")) {
          return {
            rows: [{
              blockId: "2",
              imageId: "9",
              storagePath: "images/original.webp",
              width: 1600,
              height: 900,
              variants: {
                medium: { storagePath: "images/medium.webp", width: 1200, height: 675 },
                thumbnail: { storagePath: "images/thumbnail.webp", width: 480, height: 270 },
              },
            }],
          };
        }
        return {
          rows: [{
            slug: "home",
            title: "Главная",
            seoTitle: "Кемпинг Драйв",
            seoDescription: "Отдых на природе",
            publishedAt: "2026-07-21T10:00:00.000Z",
            updatedAt: "2026-07-21T10:00:00.000Z",
            blocks: [
              { id: "2", type: "text", position: 0, content: { title: "Первый" } },
              { id: "1", type: "hero", position: 1, content: { title: "Второй" } },
            ],
          }],
        };
      },
    } as unknown as QueryExecutor;

    const response = await withServer(fakeDatabase, (baseUrl) => fetch(`${baseUrl}/api/public/pages/home`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    const body = await response.json() as {
      data: {
        slug: string;
        blocks: Array<{
          position: number;
          images: Record<string, { medium?: { url: string } }>;
        }>;
      };
    };
    assert.equal(body.data.slug, "home");
    assert.deepEqual(body.data.blocks.map((block) => block.position), [0, 1]);
    assert.equal(body.data.blocks[0]!.images["9"]!.medium!.url, "/uploads/images/medium.webp");
    assert.deepEqual(queries[0]!.values, ["home"]);
    assert.match(queries[0]!.sql, /page\.status = 'published'/);
    assert.match(queries[0]!.sql, /block\.is_visible = true/);
    assert.match(queries[0]!.sql, /ORDER BY block\.position, block\.id/);
    assert.equal(queries.length, 2);
    assert.match(queries[1]!.sql, /WHERE block\.page_id = \$1/);
  });

  it("uses the same 404 response for drafts, unknown pages, and invalid slugs", async () => {
    const fakeDatabase = {
      async query() {
        return { rows: [] };
      },
    } as unknown as QueryExecutor;

    for (const path of ["missing", "UPPERCASE", "admin", "media", "news"]) {
      const response = await withServer(fakeDatabase, (baseUrl) => fetch(`${baseUrl}/api/public/pages/${path}`));
      assert.equal(response.status, 404);
      const body = await response.json() as { error: { code: string } };
      assert.equal(body.error.code, "NOT_FOUND");
    }
  });
});

async function withServer(
  database: QueryExecutor,
  request: (baseUrl: string) => Promise<Response>,
): Promise<Response> {
  const app = express();
  app.use("/api/public/pages", createPublicPagesRouter(database));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    return await request(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}
