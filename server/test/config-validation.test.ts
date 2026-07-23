import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ensureNodeEnvironment,
  ensureProductionDatabaseSecret,
  ensurePublicSiteOrigin,
  validatePublicIndexTemplate,
} from "../src/config-validation.js";

describe("production configuration invariants", () => {
  it("requires the canonical site origin in the mutation allowlist", () => {
    assert.doesNotThrow(() => ensurePublicSiteOrigin(
      "production",
      "https://camping.example.test",
      ["https://camping.example.test"],
    ));
    assert.throws(
      () => ensurePublicSiteOrigin(
        "production",
        "https://camping.example.test",
        ["https://admin.example.test"],
      ),
      /must include PUBLIC_SITE_URL/,
    );
    assert.doesNotThrow(() => ensurePublicSiteOrigin(
      "development",
      "http://localhost:5180",
      ["http://127.0.0.1:5180"],
    ));
  });

  it("rejects environment names that would silently enable development defaults", () => {
    for (const environment of ["development", "test", "production"]) {
      assert.doesNotThrow(() => ensureNodeEnvironment(environment));
    }
    assert.throws(() => ensureNodeEnvironment("prod"), /NODE_ENV/);
  });

  it("rejects known database-password placeholders in production", () => {
    assert.doesNotThrow(() => ensureProductionDatabaseSecret(
      "production",
      "database password",
      "7x4!Qjv2-Lm9#pR6@wT8$kNz",
    ));
    assert.throws(() => ensureProductionDatabaseSecret(
      "production",
      "database password",
      "replace-with-a-long-random-password",
    ), /non-placeholder/);
    assert.throws(() => ensureProductionDatabaseSecret(
      "production",
      "database password",
      "too-short",
    ), /24 characters/);
  });

  it("requires the SSR metadata contract in the production HTML template", () => {
    assert.throws(
      () => validatePublicIndexTemplate("<html><div id=\"root\"></div></html>"),
      /SSR metadata markers/,
    );
    assert.doesNotThrow(() => validatePublicIndexTemplate(
      '<title></title><meta id="meta-description"><meta id="meta-robots">' +
      '<meta id="og-type"><meta id="og-title"><meta id="og-description">' +
      '<meta id="og-url"><meta id="og-image"><link id="canonical-url">' +
      '<script id="structured-data" type="application/ld+json"></script>' +
      '<div id="root"></div><script type="module" src="/app.js"></script>',
    ));
  });
});
