import assert from "node:assert/strict";
import { describe, it } from "node:test";

import express from "express";

import type { QueryExecutor } from "../src/database.js";
import { errorHandler } from "../src/errors.js";
import { createNewsRouter } from "../src/routes/news.js";

const currentNews = {
  id: "1",
  slug: "festival",
  title: "Фестиваль",
  excerpt: "Анонс",
  content: "Полный текст",
  coverImageId: null,
  status: "published",
  publishedAt: "2026-07-21T10:00:00.000Z",
  seoTitle: null,
  seoDescription: null,
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T10:00:00.000Z",
};

describe("administrator news API", () => {
  it("rejects publication without an excerpt and content", async () => {
    let queryCount = 0;
    const database = {
      async query() {
        queryCount += 1;
        return { rows: [] };
      },
    } as unknown as QueryExecutor;
    const response = await withServer(database, "/api/news", {
      method: "POST",
      body: JSON.stringify({ slug: "empty-news", title: "Пустая новость", status: "published" }),
    });
    assert.equal(response.status, 400);
    assert.equal(queryCount, 0);
  });

  it("validates the final record when publishing an existing draft", async () => {
    let queryCount = 0;
    const database = {
      async query() {
        queryCount += 1;
        return { rows: [{ ...currentNews, status: "draft", excerpt: "", content: "", publishedAt: null }] };
      },
    } as unknown as QueryExecutor;
    const response = await withServer(database, "/api/news/1", {
      method: "PATCH",
      body: JSON.stringify({ status: "published", expectedUpdatedAt: currentNews.updatedAt }),
    });
    assert.equal(response.status, 400);
    assert.equal(queryCount, 1);
  });

  it("requires an edit version and reports a concurrent update conflict", async () => {
    const databaseWithoutVersion = {
      async query() {
        return { rows: [] };
      },
    } as unknown as QueryExecutor;
    const missingVersion = await withServer(databaseWithoutVersion, "/api/news/1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Новое название" }),
    });
    assert.equal(missingVersion.status, 400);

    const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const database = {
      async query(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (queries.length === 1) return { rows: [currentNews] };
        return { rows: [] };
      },
    } as unknown as QueryExecutor;
    const conflict = await withServer(database, "/api/news/1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Новое название", expectedUpdatedAt: currentNews.updatedAt }),
    });
    assert.equal(conflict.status, 409);
    const body = await conflict.json() as { error: { code: string } };
    assert.equal(body.error.code, "EDIT_CONFLICT");
    assert.match(queries[1]!.sql, /updated_at = \$3::timestamptz/);
    assert.deepEqual(queries[1]!.values, ["Новое название", "1", currentNews.updatedAt]);
  });
});

async function withServer(database: QueryExecutor, path: string, init: RequestInit): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use("/api/news", createNewsRouter(database));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
