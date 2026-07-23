import assert from "node:assert/strict";
import { describe, it } from "node:test";

import express from "express";

import type { QueryExecutor } from "../src/database.js";
import { errorHandler } from "../src/errors.js";
import { createPublicNewsRouter } from "../src/routes/public-news.js";

describe("public news API", () => {
  it("returns only the requested number of published items", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] | undefined;
    const database = {
      async query(sql: string, values?: unknown[]) {
        capturedSql = sql;
        capturedValues = values;
        return { rows: [{ data: [{
          slug: "news",
          title: "Новость",
          excerpt: "Текст",
          publishedAt: "2026-07-21T00:00:00Z",
          coverImageUrl: "/uploads/news/original.webp",
          coverImageAlt: "Обложка",
          coverStoragePath: "news/original.webp",
          coverWidth: 1600,
          coverHeight: 900,
          coverVariants: {
            medium: { storagePath: "news/medium.webp", width: 1200, height: 675 },
            thumbnail: { storagePath: "news/thumbnail.webp", width: 480, height: 270 },
          },
        }], total: "1" }] };
      },
    } as unknown as QueryExecutor;
    const response = await withServer(database, "/api/public/news?limit=7&offset=14");
    assert.equal(response.status, 200);
    assert.deepEqual(capturedValues, [7, 14]);
    assert.match(capturedSql, /news\.status = 'published'/);
    assert.match(capturedSql, /news\.published_at <= now\(\)/);
    assert.match(capturedSql, /published_at DESC/);
    const body = (await response.json()) as {
      data: Array<{ coverImageSources: { medium: { url: string } } }>;
      pagination: { limit: number; offset: number; total: number };
    };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]!.coverImageSources.medium.url, "/uploads/news/medium.webp");
    assert.deepEqual(body.pagination, { limit: 7, offset: 14, total: 1 });
  });

  it("rejects limits outside the public block range", async () => {
    const database = { async query() { return { rows: [] }; } } as unknown as QueryExecutor;
    for (const limit of ["0", "13", "1.5", "many"]) {
      const response = await withServer(database, `/api/public/news?limit=${limit}`);
      assert.equal(response.status, 400);
    }
  });

  it("rejects invalid pagination offsets", async () => {
    const database = { async query() { return { rows: [] }; } } as unknown as QueryExecutor;
    for (const offset of ["-1", "1.5", "1000001", "many"]) {
      const response = await withServer(database, `/api/public/news?offset=${offset}`);
      assert.equal(response.status, 400);
    }
  });

  it("returns one published article with its content and SEO fields", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] | undefined;
    const database = {
      async query(sql: string, values?: unknown[]) {
        capturedSql = sql;
        capturedValues = values;
        return { rows: [{ slug: "festival", title: "Фестиваль", excerpt: "Анонс", content: "Полный текст", publishedAt: "2026-07-21T00:00:00Z", coverImageUrl: null, coverImageAlt: null, seoTitle: null, seoDescription: null, updatedAt: "2026-07-21T00:00:00Z" }] };
      },
    } as unknown as QueryExecutor;
    const response = await withServer(database, "/api/public/news/festival");
    assert.equal(response.status, 200);
    assert.deepEqual(capturedValues, ["festival"]);
    assert.match(capturedSql, /news\.status = 'published' AND news\.published_at <= now\(\) AND news\.slug = \$1/);
    assert.equal(((await response.json()) as { data: { content: string } }).data.content, "Полный текст");
  });

  it("does not expose a missing or draft article", async () => {
    const database = { async query() { return { rows: [] }; } } as unknown as QueryExecutor;
    for (const path of ["/api/public/news/draft-item", "/api/public/news/INVALID_SLUG", "/api/public/news/%20festival%20"]) {
      const response = await withServer(database, path);
      assert.equal(response.status, 404);
    }
  });
});

async function withServer(database: QueryExecutor, path: string): Promise<Response> {
  const app = express();
  app.use("/api/public/news", createPublicNewsRouter(database));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
