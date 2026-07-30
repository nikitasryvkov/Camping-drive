import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "./database.js";

interface StoredImagePaths extends QueryResultRow {
  storagePath: string;
  variants: Record<string, { storagePath?: unknown }>;
}

export async function sweepOrphanedImageFiles(
  database: QueryExecutor,
  options: {
    uploadsDir: string;
    minimumAgeMs?: number;
    now?: number;
  },
): Promise<number> {
  const result = await database.query<StoredImagePaths>(
    `SELECT storage_path AS "storagePath", variants
     FROM images`,
  );
  const referenced = new Set<string>();
  for (const image of result.rows) {
    referenced.add(normalizeRelativePath(image.storagePath));
    for (const variant of Object.values(image.variants ?? {})) {
      if (variant && typeof variant.storagePath === "string") {
        referenced.add(normalizeRelativePath(variant.storagePath));
      }
    }
  }

  const minimumAgeMs = options.minimumAgeMs ?? 60 * 60 * 1_000;
  const cutoff = (options.now ?? Date.now()) - minimumAgeMs;
  const files = await listStoredFiles(options.uploadsDir);
  let removed = 0;

  for (const file of files) {
    if (referenced.has(file.relativePath)) continue;
    const metadata = await lstat(file.absolutePath);
    if (metadata.mtimeMs > cutoff) continue;
    await unlink(file.absolutePath);
    removed += 1;
  }

  return removed;
}

async function listStoredFiles(
  root: string,
  directory = root,
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const files: Array<{ absolutePath: string; relativePath: string }> = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listStoredFiles(root, absolutePath));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push({
        absolutePath,
        relativePath: normalizeRelativePath(path.relative(root, absolutePath)),
      });
    }
  }
  return files;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Invalid stored image path: ${value}`);
  }
  return normalized;
}
