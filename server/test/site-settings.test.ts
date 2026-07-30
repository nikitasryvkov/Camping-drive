import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";
import type { QueryResult, QueryResultRow } from "pg";

import type { QueryExecutor } from "../src/database.js";
import { errorHandler } from "../src/errors.js";
import { createPublicSettingsRouter } from "../src/routes/public-settings.js";
import { DEFAULT_SITE_SETTINGS, parseSiteSettingsValue } from "../src/site-settings.js";

describe("site settings", () => {
  it("accepts and normalizes the complete site configuration", () => {
    const parsed = parseSiteSettingsValue({ ...DEFAULT_SITE_SETTINGS, siteName: "  Новый кемпинг  " });
    assert.equal(parsed.siteName, "Новый кемпинг");
    assert.equal(parsed.menu.length, 7);
    assert.equal(parsed.floatingActions[0]?.linkType, "primaryPhone");
  });

  it("rejects unsafe links and malformed logo references", () => {
    for (const routeUrl of [
      "javascript:alert(1)",
      "/\\evil.example",
      "/%5cevil.example",
      "/route%0aheader",
    ]) {
      assert.throws(
        () => parseSiteSettingsValue({ ...DEFAULT_SITE_SETTINGS, routeUrl }),
        /invalid data/,
      );
    }
    assert.throws(
      () => parseSiteSettingsValue({ ...DEFAULT_SITE_SETTINGS, logoImageId: "01" }),
      /invalid data/,
    );
  });
});

describe("public site settings API", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let baseUrl = "";

  before(async () => {
    const database: QueryExecutor = {
      async query<T extends QueryResultRow>(): Promise<QueryResult<T>> {
        return {
          rows: [{ value: DEFAULT_SITE_SETTINGS, updatedAt: "2026-07-21T12:00:00Z", logoUrl: "/uploads/logo-thumbnail.webp" } as unknown as T],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      },
    };
    const app = express();
    app.use("/api/public/settings", createPublicSettingsRouter(database));
    app.use(errorHandler);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("returns public navigation, contacts, footer and resolved logo", async () => {
    const response = await fetch(`${baseUrl}/api/public/settings`);
    assert.equal(response.status, 200);
    const body = await response.json() as { data: Record<string, unknown> };
    assert.equal(body.data.siteName, "Кемпинг Драйв");
    assert.equal(body.data.logoUrl, "/uploads/logo-thumbnail.webp");
    assert.ok(Array.isArray(body.data.phones));
    assert.ok(Array.isArray(body.data.menu));
    assert.ok(Array.isArray(body.data.floatingActions));
  });
});
