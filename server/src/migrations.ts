import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { createMigrationDatabase } from "./database.js";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationFilePattern = /^(\d{3})_[a-z0-9_]+\.sql$/;
const advisoryLockId = 1_836_447_212;
const acceptedLegacyChecksums = new Map<string, {
  currentChecksum: string;
  legacyChecksums: ReadonlySet<string>;
}>([
  ["006_seed_public_home_page.sql", {
    currentChecksum: "2071ff5d9cf93b41b1b822848927fdcde65a05eeb3868accc6f88281074f43e4",
    legacyChecksums: new Set([
      "b51d1083746228b7d972eb735f18ac6db053d40660fb0bbe1d4f6f3928ca2c22",
    ]),
  }],
  ["008_stage_8_site_settings.sql", {
    currentChecksum: "2b88150ce0ab58b8eec5437ee02412e2d11ee25bcd50367f86b8387ab61ca1b8",
    legacyChecksums: new Set([
      "de265587be312092e82b45c22ab2774f64828ca37cef2f1a83a8d85eea92f013",
    ]),
  }],
]);

export async function runMigrations(): Promise<void> {
  const directoryNames = await readdir(migrationsDirectory);
  const invalidSqlNames = directoryNames.filter(
    (name) => name.endsWith(".sql") && !migrationFilePattern.test(name),
  );

  if (invalidSqlNames.length > 0) {
    throw new Error(`Invalid database migration filenames: ${invalidSqlNames.join(", ")}`);
  }

  const migrationNames = directoryNames.filter((name) => migrationFilePattern.test(name)).sort();

  if (migrationNames.length === 0) {
    throw new Error(`No database migrations found in ${migrationsDirectory}`);
  }

  const versions = new Set<string>();
  const versionByName = new Map<string, number>();
  for (const name of migrationNames) {
    const version = migrationFilePattern.exec(name)![1]!;
    if (version === "000") {
      throw new Error("Database migration versions must start at 001");
    }
    if (versions.has(version)) {
      throw new Error(`Duplicate database migration version ${version}`);
    }
    versions.add(version);
    versionByName.set(name, Number(version));
  }

  const migrations = await Promise.all(
    migrationNames.map(async (name) => {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      return { name, sql, checksum };
    }),
  );

  const migrationDatabase = createMigrationDatabase();
  let client: PoolClient | undefined;

  try {
    client = await migrationDatabase.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '130s'");
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS locked`,
      [advisoryLockId],
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Another migration process already holds the database migration lock");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const applied = new Map(
      appliedResult.rows.map((migration) => [migration.name, migration.checksum.trim()]),
    );

    for (const appliedName of applied.keys()) {
      if (!migrationNames.includes(appliedName)) {
        throw new Error(`Applied migration ${appliedName} is missing from the application`);
      }
    }

    const highestAppliedVersion = Math.max(
      0,
      ...[...applied.keys()].map((name) => versionByName.get(name)!),
    );

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.name);

      if (appliedChecksum && appliedChecksum !== migration.checksum) {
        if (!isAcceptedLegacyChecksum(migration.name, appliedChecksum, migration.checksum)) {
          throw new Error(`Migration ${migration.name} has changed after it was applied`);
        }
        console.warn(`Accepted the documented legacy checksum for ${migration.name}`);
      }

      if (appliedChecksum) {
        continue;
      }

      if (versionByName.get(migration.name)! < highestAppliedVersion) {
        throw new Error(
          `Migration ${migration.name} was added before an already applied migration`,
        );
      }

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [migration.name, migration.checksum],
      );
      console.log(`Applied database migration ${migration.name}`);
    }

    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Failed to roll back database migrations", rollbackError);
      }
    }
    throw error;
  } finally {
    client?.release();
    await migrationDatabase.end();
  }
}

export function isAcceptedLegacyChecksum(
  migrationName: string,
  appliedChecksum: string,
  currentChecksum: string,
): boolean {
  const compatibility = acceptedLegacyChecksums.get(migrationName);
  return (
    compatibility?.currentChecksum === currentChecksum &&
    compatibility.legacyChecksums.has(appliedChecksum)
  );
}
