import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { BLOCK_DEFINITIONS } from "../../src/admin/pageBlocks.js";
import { toApiError } from "../../src/admin/api.js";
import { publicationDateForSave } from "../../src/admin/newsDate.js";
import { DEFAULT_SITE_SETTINGS as FRONTEND_DEFAULTS } from "../../src/siteSettings.js";
import { ValidationError } from "../src/errors.js";
import {
  MAX_PAGE_BLOCKS,
  MAX_PAGE_COLLECTION_ITEMS,
  PAGE_BLOCK_TYPES,
  validatePageBlockContent,
  validatePageContentBudget,
} from "../src/page-blocks.js";
import { DEFAULT_SITE_SETTINGS as BACKEND_DEFAULTS } from "../src/site-settings.js";

describe("frontend/backend contracts", () => {
  it("keeps page block types aligned", () => {
    assert.deepEqual(BLOCK_DEFINITIONS.map((definition) => definition.type), [...PAGE_BLOCK_TYPES]);
  });

  it("keeps every editor block default valid for the backend", () => {
    for (const definition of BLOCK_DEFINITIONS) {
      assert.doesNotThrow(
        () => validatePageBlockContent(definition.type, definition.defaultContent),
        `Invalid default content for ${definition.type}`,
      );
    }
  });

  it("keeps default public settings aligned", () => {
    assert.deepEqual(FRONTEND_DEFAULTS, BACKEND_DEFAULTS);
  });

  it("rejects pages that exceed rendering budgets", () => {
    assert.throws(
      () => validatePageContentBudget(Array.from(
        { length: MAX_PAGE_BLOCKS + 1 },
        () => ({ content: {} }),
      )),
      hasValidationDetail("no more than 60 blocks"),
    );
    assert.throws(
      () => validatePageContentBudget([{
        content: {
          items: Array.from(
            { length: MAX_PAGE_COLLECTION_ITEMS + 1 },
            () => ({ title: "item" }),
          ),
        },
      }]),
      hasValidationDetail("no more than 300 collection items"),
    );
    assert.throws(
      () => validatePageContentBudget([{ content: { body: "x".repeat(513 * 1024) } }]),
      hasValidationDetail("Combined block content"),
    );
  });

  it("rejects link-only schemes in image URL fields", () => {
    for (const imageUrl of [
      "mailto:guest@example.com",
      "tel:+79990000000",
      "#gallery",
      "/\\evil.example/image.webp",
      "/%5cevil.example/image.webp",
      "/images/%0aheader.webp",
    ]) {
      assert.throws(
        () => validatePageBlockContent("gallery", {
          items: [{ imageId: null, imageUrl, imageAlt: "Фото", caption: "" }],
        }),
        hasValidationDetail("root-relative image URL"),
      );
    }
    assert.doesNotThrow(() => validatePageBlockContent("gallery", {
      items: [{
        imageId: null,
        imageUrl: "/images/camp.webp",
        imageAlt: "Фото",
        caption: "",
      }],
    }));
  });

  it("keeps rate-limit and payload errors specific to their API operation", () => {
    const genericRateLimit = toApiError(
      new Response("", { status: 429 }),
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
    );
    const loginRateLimit = toApiError(
      new Response("", { status: 429 }),
      { error: { code: "TOO_MANY_LOGIN_ATTEMPTS", message: "Too many attempts" } },
    );
    const jsonPayload = toApiError(
      new Response("", { status: 413 }),
      { error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large" } },
    );
    const imagePayload = toApiError(
      new Response("", { status: 413 }),
      { error: { code: "IMAGE_TOO_LARGE", message: "Image too large" } },
    );

    assert.notEqual(genericRateLimit.message, loginRateLimit.message);
    assert.notEqual(jsonPayload.message, imagePayload.message);
    assert.equal(genericRateLimit.code, "RATE_LIMITED");
    assert.equal(jsonPayload.code, "PAYLOAD_TOO_LARGE");
  });

  it("preserves exact publication timestamps until the date field is edited", () => {
    const original = "2026-07-23T12:34:56.789Z";
    assert.equal(
      publicationDateForSave("2026-07-23T15:34", original, false),
      original,
    );
    assert.notEqual(
      publicationDateForSave("2026-07-23T15:34", original, true),
      original,
    );
  });

  it("ships the same backend production dependency closure that is compiled and tested", () => {
    const rootLock = JSON.parse(
      readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
    ) as PackageLock;
    const runtimePackage = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    const runtimeLock = JSON.parse(
      readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
    ) as PackageLock;

    for (const [dependency, declaredVersion] of Object.entries(runtimePackage.dependencies)) {
      const packagePath = `node_modules/${dependency}`;
      assert.equal(
        runtimeLock.packages[packagePath]?.version,
        declaredVersion,
        `${dependency} must be exactly pinned in the runtime package`,
      );
      assert.equal(
        rootLock.packages[packagePath]?.version,
        runtimeLock.packages[packagePath]?.version,
        `${dependency} differs between the tested and shipped dependency graphs`,
      );
    }
    assert.deepEqual(
      productionDependencyClosure(rootLock, Object.keys(runtimePackage.dependencies)),
      productionDependencyClosure(runtimeLock, Object.keys(runtimePackage.dependencies)),
    );
  });

  it("binds production mutations to a clean reviewed commit and approved image manifest", () => {
    const releaseWrapper = readFileSync(
      new URL("../../scripts/compose-mutation.sh", import.meta.url),
      "utf8",
    );
    const managedCompose = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
    const dockerfiles = [
      readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8"),
      readFileSync(new URL("../../docker/postgres.Dockerfile", import.meta.url), "utf8"),
      readFileSync(new URL("../../docker/caddy.Dockerfile", import.meta.url), "utf8"),
    ];

    assert.match(releaseWrapper, /RELEASE_COMMIT must be the full 40-character commit SHA/);
    assert.match(releaseWrapper, /git status --porcelain --untracked-files=normal/);
    assert.match(releaseWrapper, /RELEASE_MANIFEST_SHA256 must be the approved SHA-256/);
    assert.match(releaseWrapper, /local image ID is not approved by the release manifest/);
    assert.match(releaseWrapper, /org\.opencontainers\.image\.revision/);
    assert.match(releaseWrapper, /git archive --format=tar/);
    assert.match(releaseWrapper, /public_site_url=%s/);
    for (const dockerfile of dockerfiles) {
      assert.match(dockerfile, /LABEL org\.opencontainers\.image\.revision=/);
    }
    assert.match(
      managedCompose,
      /caddy-volume-init:[\s\S]*?network_mode:\s+none[\s\S]*?\n  caddy:/,
    );
  });

  it("keeps proxy trust CIDRs and hop counts aligned with both Compose topologies", () => {
    const nginx = readFileSync(new URL("../../docker/nginx.conf", import.meta.url), "utf8");
    const managedCompose = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
    const externalCompose = readFileSync(
      new URL("../../compose.app-only.yaml", import.meta.url),
      "utf8",
    );
    const trustedCidrs = [...nginx.matchAll(/set_real_ip_from\s+([^;]+);/g)]
      .map((match) => match[1])
      .sort();
    const edgeCidrs = [managedCompose, externalCompose]
      .flatMap((compose) => [...compose.matchAll(/subnet:\s+([^\s]+)/g)].map((match) => match[1]))
      .sort();

    assert.deepEqual(trustedCidrs, edgeCidrs);
    for (const compose of [managedCompose, externalCompose]) {
      assert.equal(
        [...compose.matchAll(/TRUST_PROXY_HOPS:\s+2/g)].length,
        1,
        "Every backend topology must trust exactly the external proxy and Nginx hops",
      );
    }
  });
});

interface PackageLock {
  packages: Record<string, LockedPackage>;
}

interface LockedPackage {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function productionDependencyClosure(lock: PackageLock, roots: string[]): string[] {
  const visited = new Set<string>();
  const identities = new Set<string>();
  const queue = roots.map((dependency) => resolvePackagePath(lock, "", dependency));

  while (queue.length > 0) {
    const packagePath = queue.shift();
    assert.ok(packagePath, "Production dependency is absent from package-lock.json");
    if (visited.has(packagePath)) continue;
    visited.add(packagePath);
    const lockedPackage = lock.packages[packagePath];
    assert.ok(lockedPackage?.version, `Missing locked version for ${packagePath}`);
    const name = lockedPackage.name ?? packageNameFromPath(packagePath);
    identities.add(`${name}@${lockedPackage.version}`);
    const dependencies = {
      ...lockedPackage.dependencies,
      ...lockedPackage.optionalDependencies,
    };
    for (const dependency of Object.keys(dependencies)) {
      const resolved = resolvePackagePath(lock, packagePath, dependency);
      if (resolved) queue.push(resolved);
    }
  }

  return [...identities].sort();
}

function resolvePackagePath(
  lock: PackageLock,
  parentPath: string,
  dependency: string,
): string | undefined {
  let ancestor = parentPath;
  while (ancestor) {
    const candidate = `${ancestor}/node_modules/${dependency}`;
    if (lock.packages[candidate]) return candidate;
    const nestedIndex = ancestor.lastIndexOf("/node_modules/");
    ancestor = nestedIndex === -1 ? "" : ancestor.slice(0, nestedIndex);
  }
  const rootCandidate = `node_modules/${dependency}`;
  return lock.packages[rootCandidate] ? rootCandidate : undefined;
}

function packageNameFromPath(packagePath: string): string {
  const marker = "node_modules/";
  const last = packagePath.lastIndexOf(marker);
  return packagePath.slice(last + marker.length);
}

function hasValidationDetail(expected: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof ValidationError &&
    JSON.stringify(error.details).includes(expected);
}
