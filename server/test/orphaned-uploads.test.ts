import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { QueryExecutor } from "../src/database.js";
import { sweepOrphanedImageFiles } from "../src/orphaned-uploads.js";

test("orphan sweep preserves referenced and recent files but removes old unreferenced files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camping-drive-orphans-"));
  const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1_000);
  try {
    for (const relativePath of ["referenced/original.webp", "recent/original.webp", "orphan/original.webp"]) {
      const absolutePath = path.join(root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, relativePath);
    }
    await utimes(path.join(root, "referenced/original.webp"), oldTime, oldTime);
    await utimes(path.join(root, "orphan/original.webp"), oldTime, oldTime);

    const database = {
      async query() {
        return {
          rows: [{ storagePath: "referenced/original.webp", variants: {} }],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      },
    } as QueryExecutor;

    const removed = await sweepOrphanedImageFiles(database, { uploadsDir: root });
    assert.equal(removed, 1);
    assert.equal(await fileExists(path.join(root, "referenced/original.webp")), true);
    assert.equal(await fileExists(path.join(root, "recent/original.webp")), true);
    assert.equal(await fileExists(path.join(root, "orphan/original.webp")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await import("node:fs/promises").then(({ access }) => access(filePath));
    return true;
  } catch {
    return false;
  }
}
