import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

import { config } from "../src/config.js";
import { createMigrationDatabase } from "../src/database.js";
import { isAcceptedLegacyChecksum, runMigrations } from "../src/migrations.js";
import {
  provisionRuntimeDatabaseRole,
  runtimeRoleMarker,
} from "../src/provision-runtime-role.js";
import { DEFAULT_SITE_SETTINGS } from "../src/site-settings.js";
import { validateProductionData } from "../src/validate-production-data.js";

if (!config.database.database.endsWith("_test")) {
  throw new Error("Migration integration test requires a database name ending with _test");
}

const database = createMigrationDatabase();

try {
  await resetSchema();
  await database.query(`
    CREATE TABLE schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const name of [
    "001_stage_2_schema.sql",
    "002_image_references_and_admin_login.sql",
    "003_administrator_sessions.sql",
    "004_protect_used_images.sql",
    "005_image_deletion_queue.sql",
  ]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await database.query(sql);
    await database.query(
      "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
      [name, createHash("sha256").update(sql).digest("hex")],
    );
  }

  const page = await database.query<{ id: string }>(
    `INSERT INTO pages (slug, title, status, seo_title, seo_description)
     VALUES ('home', 'Черновик владельца', 'draft', 'Свой SEO title', 'Своё SEO description')
     RETURNING id::text AS id`,
  );
  await database.query(
    `INSERT INTO page_blocks (page_id, type, position, is_visible, content)
     VALUES ($1, 'text', 0, true, '{"title":"Пользовательский блок","body":"Не перезаписывать"}'::jsonb)`,
    [page.rows[0]!.id],
  );
  const customSiteSettings = { ...DEFAULT_SITE_SETTINGS, siteName: "Пользовательские настройки" };
  await database.query(
    `INSERT INTO site_settings (key, value, description, is_public)
     VALUES ('site', $1::jsonb, 'До обновления', true)`,
    [JSON.stringify(customSiteSettings)],
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  await runMigrations();

  const migratedPage = await database.query<{
    status: string;
    publishedAt: string | null;
    title: string;
    seoTitle: string | null;
    blockTitle: string;
  }>(
    `SELECT
       page.status,
       page.published_at AS "publishedAt",
       page.title,
       page.seo_title AS "seoTitle",
       block.content->>'title' AS "blockTitle"
     FROM pages AS page
     JOIN page_blocks AS block ON block.page_id = page.id
     WHERE page.slug = 'home'`,
  );
  assert.deepEqual(migratedPage.rows[0], {
    status: "draft",
    publishedAt: null,
    title: "Черновик владельца",
    seoTitle: "Свой SEO title",
    blockTitle: "Пользовательский блок",
  });

  const migratedSettings = await database.query<{ value: Record<string, unknown> }>(
    "SELECT value FROM site_settings WHERE key = 'site'",
  );
  assert.deepEqual(migratedSettings.rows[0]!.value, customSiteSettings);

  const hardening = await database.query<{ tableName: string | null; nextAttemptAt: string | null }>(
    `SELECT
       to_regclass('public.administrator_login_rate_limits')::text AS "tableName",
       column_name AS "nextAttemptAt"
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'image_deletion_queue'
       AND column_name = 'next_attempt_at'`,
  );
  assert.equal(hardening.rows[0]?.tableName, "administrator_login_rate_limits");
  assert.equal(hardening.rows[0]?.nextAttemptAt, "next_attempt_at");
  await database.query(
    `UPDATE schema_migrations
     SET checksum = CASE name
       WHEN '006_seed_public_home_page.sql' THEN 'b51d1083746228b7d972eb735f18ac6db053d40660fb0bbe1d4f6f3928ca2c22'
       WHEN '008_stage_8_site_settings.sql' THEN 'de265587be312092e82b45c22ab2774f64828ca37cef2f1a83a8d85eea92f013'
       ELSE checksum
     END
     WHERE name IN ('006_seed_public_home_page.sql', '008_stage_8_site_settings.sql')`,
  );
  await runMigrations();
  assert.equal(
    isAcceptedLegacyChecksum(
      "006_seed_public_home_page.sql",
      "b51d1083746228b7d972eb735f18ac6db053d40660fb0bbe1d4f6f3928ca2c22",
      "0".repeat(64),
    ),
    false,
  );
  await verifyRuntimeRoleCannotInheritPrivileges();
  await verifyRuntimeRoleCannotOwnObjects();
  await verifyUnmanagedRuntimeRoleIsRejectedWithoutMutation();
  await verifyRuntimeRoleProvisioningIsAtomic();
  await verifyRuntimeRolePrivilegesAreReduced();
  await verifyMalformedPublishedBlocksAreRejected();
  console.log(JSON.stringify({ status: "passed", preservedLegacyData: true }));
} finally {
  await resetSchema();
  await database.end();
}

async function resetSchema(): Promise<void> {
  await database.query("DROP SCHEMA IF EXISTS public CASCADE");
  await database.query("CREATE SCHEMA public");
}

async function markRuntimeRole(role: string): Promise<void> {
  const identity = await database.query<{ databaseName: string; ownerName: string }>(
    `SELECT current_database() AS "databaseName", current_user AS "ownerName"`,
  );
  const marker = runtimeRoleMarker(
    identity.rows[0]!.databaseName,
    identity.rows[0]!.ownerName,
  );
  const statement = await database.query<{ statement: string }>(
    `SELECT format('COMMENT ON ROLE %I IS %L', $1::text, $2::text) AS statement`,
    [role, marker],
  );
  await database.query(statement.rows[0]!.statement);
}

async function verifyRuntimeRoleCannotInheritPrivileges(): Promise<void> {
  const suffix = `${process.pid}_${Date.now()}`;
  const parentRole = `camping_parent_${suffix}`;
  const runtimeRole = `camping_runtime_${suffix}`;
  const previousUser = process.env.APP_DB_USER;
  const previousPassword = process.env.APP_DB_PASSWORD;

  await database.query(`CREATE ROLE ${parentRole} NOLOGIN`);
  await database.query(`CREATE ROLE ${runtimeRole} LOGIN`);
  await markRuntimeRole(runtimeRole);
  await database.query(`GRANT ${parentRole} TO ${runtimeRole}`);
  process.env.APP_DB_USER = runtimeRole;
  process.env.APP_DB_PASSWORD = "integration-runtime-password-123456";

  try {
    await assert.rejects(
      provisionRuntimeDatabaseRole,
      /APP_DB_USER must not participate in PostgreSQL role memberships/,
    );
    const role = await database.query<{ inherits: boolean }>(
      `SELECT rolinherit AS inherits FROM pg_roles WHERE rolname = $1`,
      [runtimeRole],
    );
    assert.equal(role.rows[0]?.inherits, true);
    const membership = await database.query(
      `SELECT 1
       FROM pg_auth_members
       WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)
         AND member = (SELECT oid FROM pg_roles WHERE rolname = $2)`,
      [parentRole, runtimeRole],
    );
    assert.equal(membership.rowCount, 1);
    await database.query(`REVOKE ${parentRole} FROM ${runtimeRole}`);
    await database.query(`GRANT ${runtimeRole} TO ${parentRole}`);
    await assert.rejects(
      provisionRuntimeDatabaseRole,
      /APP_DB_USER must not participate in PostgreSQL role memberships/,
    );
    const inboundMembership = await database.query(
      `SELECT 1
       FROM pg_auth_members
       WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)
         AND member = (SELECT oid FROM pg_roles WHERE rolname = $2)`,
      [runtimeRole, parentRole],
    );
    assert.equal(inboundMembership.rowCount, 1);
  } finally {
    if (previousUser === undefined) delete process.env.APP_DB_USER;
    else process.env.APP_DB_USER = previousUser;
    if (previousPassword === undefined) delete process.env.APP_DB_PASSWORD;
    else process.env.APP_DB_PASSWORD = previousPassword;
    await database.query(`REVOKE ${parentRole} FROM ${runtimeRole}`);
    await database.query(`REVOKE ${runtimeRole} FROM ${parentRole}`);
    await database.query(`DROP ROLE ${runtimeRole}`);
    await database.query(`DROP ROLE ${parentRole}`);
  }
}

async function verifyMalformedPublishedBlocksAreRejected(): Promise<void> {
  const page = await database.query<{ id: string }>(
    `INSERT INTO pages (slug, title, status)
     VALUES ('invalid-production-page', 'Invalid production page', 'published')
     RETURNING id::text AS id`,
  );
  await database.query(
    `INSERT INTO page_blocks (page_id, type, position, is_visible, content)
     VALUES ($1, 'unsupported-production-block', 0, true, '{}'::jsonb)`,
    [page.rows[0]!.id],
  );
  try {
    await assert.rejects(
      validateProductionData,
      /contains unsupported block type/,
    );
  } finally {
    await database.query("DELETE FROM pages WHERE id = $1", [page.rows[0]!.id]);
  }
}

async function verifyRuntimeRoleCannotOwnObjects(): Promise<void> {
  const suffix = `${process.pid}_${Date.now()}`;
  const runtimeRole = `camping_owner_${suffix}`;
  const ownedTable = `runtime_owned_${suffix}`;
  const previousUser = process.env.APP_DB_USER;
  const previousPassword = process.env.APP_DB_PASSWORD;
  const identity = await database.query<{ currentUser: string }>(
    `SELECT current_user AS "currentUser"`,
  );

  await database.query(`CREATE ROLE ${runtimeRole} LOGIN`);
  await markRuntimeRole(runtimeRole);
  await database.query(`CREATE TABLE ${ownedTable}(id integer)`);
  await database.query(`ALTER TABLE ${ownedTable} OWNER TO ${runtimeRole}`);
  process.env.APP_DB_USER = runtimeRole;
  process.env.APP_DB_PASSWORD = "integration-runtime-password-123456";

  try {
    await assert.rejects(
      provisionRuntimeDatabaseRole,
      /APP_DB_USER must not own database objects/,
    );
  } finally {
    if (previousUser === undefined) delete process.env.APP_DB_USER;
    else process.env.APP_DB_USER = previousUser;
    if (previousPassword === undefined) delete process.env.APP_DB_PASSWORD;
    else process.env.APP_DB_PASSWORD = previousPassword;
    await database.query(`ALTER TABLE ${ownedTable} OWNER TO ${identity.rows[0]!.currentUser}`);
    await database.query(`DROP TABLE ${ownedTable}`);
    await database.query(`DROP ROLE ${runtimeRole}`);
  }
}

async function verifyRuntimeRolePrivilegesAreReduced(): Promise<void> {
  const suffix = `${process.pid}_${Date.now()}`;
  const runtimeRole = `camping_acl_${suffix}`;
  const extraSchema = `camping_extra_${suffix}`;
  const previousUser = process.env.APP_DB_USER;
  const previousPassword = process.env.APP_DB_PASSWORD;
  const databaseName = await database.query<{ databaseName: string }>(
    `SELECT format('%I', current_database()) AS "databaseName"`,
  );
  const db = databaseName.rows[0]!.databaseName;

  await database.query(`CREATE ROLE ${runtimeRole} LOGIN`);
  await markRuntimeRole(runtimeRole);
  await database.query(`GRANT CREATE ON SCHEMA public TO ${runtimeRole}`);
  await database.query(`GRANT TEMPORARY ON DATABASE ${db} TO ${runtimeRole}`);
  await database.query(`GRANT EXECUTE ON FUNCTION set_updated_at() TO ${runtimeRole}`);
  await database.query(`CREATE SCHEMA ${extraSchema}`);
  await database.query(`CREATE TABLE ${extraSchema}.secret(id integer)`);
  await database.query(`GRANT USAGE ON SCHEMA ${extraSchema} TO ${runtimeRole}`);
  await database.query(`GRANT SELECT ON ${extraSchema}.secret TO ${runtimeRole}`);
  await database.query(`ALTER ROLE ${runtimeRole} SET search_path TO ${extraSchema}, public`);
  await database.query(`ALTER ROLE ${runtimeRole} CONNECTION LIMIT 1 VALID UNTIL '2000-01-01'`);
  process.env.APP_DB_USER = runtimeRole;
  process.env.APP_DB_PASSWORD = "integration-runtime-password-123456";

  try {
    await provisionRuntimeDatabaseRole();
    const runtimeDatabase = new Pool({
      ...config.database,
      user: runtimeRole,
      password: "integration-runtime-password-123456",
      max: 1,
    });
    try {
      await runtimeDatabase.query("BEGIN");
      const runtimePage = await runtimeDatabase.query<{ id: string }>(
        `INSERT INTO pages (slug, title, status)
         VALUES ($1, 'Runtime role CRUD', 'draft')
         RETURNING id::text`,
        [`runtime-crud-${suffix.replaceAll("_", "-")}`],
      );
      await runtimeDatabase.query(
        "UPDATE pages SET title = 'Runtime role updated' WHERE id = $1",
        [runtimePage.rows[0]!.id],
      );
      await runtimeDatabase.query("DELETE FROM pages WHERE id = $1", [runtimePage.rows[0]!.id]);
      await runtimeDatabase.query("ROLLBACK");
    } finally {
      await runtimeDatabase.end();
    }
    const privileges = await database.query<{
      canCreate: boolean;
      canExecute: boolean;
      canUseExtraSchema: boolean;
      canUseTemporary: boolean;
      connectionLimit: number;
      validUntil: string | null;
      roleSettings: string[] | null;
    }>(
      `SELECT
         has_schema_privilege($1, 'public', 'CREATE') AS "canCreate",
         has_function_privilege($1, 'set_updated_at()', 'EXECUTE') AS "canExecute",
         has_database_privilege($1, current_database(), 'TEMPORARY') AS "canUseTemporary",
         has_schema_privilege($1, $2, 'USAGE') AS "canUseExtraSchema",
         role.rolconnlimit AS "connectionLimit",
         role.rolvaliduntil AS "validUntil",
         setting.setconfig AS "roleSettings"
       FROM pg_roles AS role
       LEFT JOIN pg_db_role_setting AS setting
         ON setting.setrole = role.oid
        AND setting.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
       WHERE role.rolname = $1`,
      [runtimeRole, extraSchema],
    );
    assert.deepEqual(privileges.rows[0], {
      canCreate: false,
      canExecute: false,
      canUseExtraSchema: false,
      canUseTemporary: false,
      connectionLimit: -1,
      validUntil: "infinity",
      roleSettings: ["search_path=pg_catalog, public"],
    });
  } finally {
    if (previousUser === undefined) delete process.env.APP_DB_USER;
    else process.env.APP_DB_USER = previousUser;
    if (previousPassword === undefined) delete process.env.APP_DB_PASSWORD;
    else process.env.APP_DB_PASSWORD = previousPassword;
    await database.query(`DROP OWNED BY ${runtimeRole}`);
    await database.query(`DROP ROLE ${runtimeRole}`);
    await database.query(`DROP SCHEMA ${extraSchema} CASCADE`);
  }
}

async function verifyRuntimeRoleProvisioningIsAtomic(): Promise<void> {
  const suffix = `${process.pid}_${Date.now()}`;
  const runtimeRole = `camping_atomic_${suffix}`;
  const previousUser = process.env.APP_DB_USER;
  const previousPassword = process.env.APP_DB_PASSWORD;
  const previousFailure = process.env.RUNTIME_ROLE_PROVISION_FAIL_AFTER_ROLE_MUTATION_FOR_TESTS;

  await database.query(`CREATE ROLE ${runtimeRole} LOGIN INHERIT PASSWORD 'original-runtime-password'`);
  await markRuntimeRole(runtimeRole);
  const before = await database.query<{ inherits: boolean; passwordHash: string | null }>(
    `SELECT rolinherit AS inherits, rolpassword AS "passwordHash"
     FROM pg_authid
     WHERE rolname = $1`,
    [runtimeRole],
  );
  process.env.APP_DB_USER = runtimeRole;
  process.env.APP_DB_PASSWORD = "replacement-runtime-password-123456";
  process.env.RUNTIME_ROLE_PROVISION_FAIL_AFTER_ROLE_MUTATION_FOR_TESTS = "yes";

  try {
    await assert.rejects(
      provisionRuntimeDatabaseRole,
      /Injected runtime-role provisioning failure/,
    );
    const after = await database.query<{ inherits: boolean; passwordHash: string | null }>(
      `SELECT rolinherit AS inherits, rolpassword AS "passwordHash"
       FROM pg_authid
       WHERE rolname = $1`,
      [runtimeRole],
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    if (previousUser === undefined) delete process.env.APP_DB_USER;
    else process.env.APP_DB_USER = previousUser;
    if (previousPassword === undefined) delete process.env.APP_DB_PASSWORD;
    else process.env.APP_DB_PASSWORD = previousPassword;
    if (previousFailure === undefined) {
      delete process.env.RUNTIME_ROLE_PROVISION_FAIL_AFTER_ROLE_MUTATION_FOR_TESTS;
    } else {
      process.env.RUNTIME_ROLE_PROVISION_FAIL_AFTER_ROLE_MUTATION_FOR_TESTS = previousFailure;
    }
    await database.query(`DROP ROLE ${runtimeRole}`);
  }
}

async function verifyUnmanagedRuntimeRoleIsRejectedWithoutMutation(): Promise<void> {
  const suffix = `${process.pid}_${Date.now()}`;
  const runtimeRole = `camping_unmanaged_${suffix}`;
  const previousUser = process.env.APP_DB_USER;
  const previousPassword = process.env.APP_DB_PASSWORD;

  await database.query(
    `CREATE ROLE ${runtimeRole} LOGIN CREATEDB PASSWORD 'unmanaged-original-password'`,
  );
  const before = await database.query<{
    canLogin: boolean;
    canCreateDatabase: boolean;
    passwordHash: string | null;
  }>(
    `SELECT
       rolcanlogin AS "canLogin",
       rolcreatedb AS "canCreateDatabase",
       rolpassword AS "passwordHash"
     FROM pg_authid
     WHERE rolname = $1`,
    [runtimeRole],
  );
  process.env.APP_DB_USER = runtimeRole;
  process.env.APP_DB_PASSWORD = "replacement-runtime-password-123456";

  try {
    await assert.rejects(
      provisionRuntimeDatabaseRole,
      /not a role managed by this application and database/,
    );
    const after = await database.query<{
      canLogin: boolean;
      canCreateDatabase: boolean;
      passwordHash: string | null;
    }>(
      `SELECT
         rolcanlogin AS "canLogin",
         rolcreatedb AS "canCreateDatabase",
         rolpassword AS "passwordHash"
       FROM pg_authid
       WHERE rolname = $1`,
      [runtimeRole],
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    if (previousUser === undefined) delete process.env.APP_DB_USER;
    else process.env.APP_DB_USER = previousUser;
    if (previousPassword === undefined) delete process.env.APP_DB_PASSWORD;
    else process.env.APP_DB_PASSWORD = previousPassword;
    await database.query(`DROP ROLE ${runtimeRole}`);
  }
}
