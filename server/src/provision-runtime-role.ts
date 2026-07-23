import { createMigrationDatabase } from "./database.js";
import { config } from "./config.js";
import { ensureProductionDatabaseSecret } from "./config-validation.js";

const rolePattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function runtimeRoleMarker(databaseName: string, ownerName: string): string {
  return `camping-drive:runtime-role:v1:${databaseName}:${ownerName}`;
}

export async function provisionRuntimeDatabaseRole(): Promise<void> {
  const role = process.env.APP_DB_USER?.trim();
  const password = process.env.APP_DB_PASSWORD;
  if (!role && !password) return;
  if (!role || !password) {
    throw new Error("APP_DB_USER and APP_DB_PASSWORD must be configured together");
  }
  if (!rolePattern.test(role)) {
    throw new Error("APP_DB_USER must be a valid PostgreSQL role name");
  }
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === "public" || normalizedRole === "none" || normalizedRole.startsWith("pg_")) {
    throw new Error("APP_DB_USER must not use a reserved or predefined PostgreSQL role name");
  }
  if (password.length < 24) {
    throw new Error("APP_DB_PASSWORD must contain at least 24 characters");
  }
  ensureProductionDatabaseSecret(config.nodeEnv, "APP_DB_PASSWORD", password);
  if (password === config.database.password) {
    throw new Error("APP_DB_PASSWORD must differ from the migration-owner password");
  }

  const admin = createMigrationDatabase();
  try {
    const identity = await admin.query<{ currentUser: string; databaseName: string }>(
      `SELECT current_user AS "currentUser", current_database() AS "databaseName"`,
    );
    const currentUser = identity.rows[0]!.currentUser;
    const databaseName = identity.rows[0]!.databaseName;
    if (role === currentUser) {
      throw new Error("APP_DB_USER must differ from the migration owner");
    }
    const expectedRoleMarker = runtimeRoleMarker(databaseName, currentUser);
    const existingRole = await admin.query<{
      roleName: string;
      isSuperuser: boolean;
      canCreateRole: boolean;
      canCreateDatabase: boolean;
      canReplicate: boolean;
      bypassesRowSecurity: boolean;
      marker: string | null;
    }>(
      `SELECT
         rolname AS "roleName",
         rolsuper AS "isSuperuser",
         rolcreaterole AS "canCreateRole",
         rolcreatedb AS "canCreateDatabase",
         rolreplication AS "canReplicate",
         rolbypassrls AS "bypassesRowSecurity",
         shobj_description(oid, 'pg_authid') AS marker
       FROM pg_authid
       WHERE rolname = $1`,
      [role],
    );
    if (existingRole.rowCount !== 0) {
      const existing = existingRole.rows[0]!;
      if (existing.marker !== expectedRoleMarker) {
        throw new Error(
          "APP_DB_USER already exists but is not a role managed by this application and database",
        );
      }
      if (
        existing.isSuperuser ||
        existing.canCreateRole ||
        existing.canCreateDatabase ||
        existing.canReplicate ||
        existing.bypassesRowSecurity
      ) {
        throw new Error("The managed APP_DB_USER has elevated PostgreSQL attributes");
      }
    }

    const formatted = await admin.query<{
      roleName: string;
      passwordLiteral: string;
      databaseName: string;
      ownerName: string;
      markerLiteral: string;
    }>(
      `SELECT
         format('%I', $1::text) AS "roleName",
         format('%L', $2::text) AS "passwordLiteral",
         format('%I', $3::text) AS "databaseName",
         format('%I', $4::text) AS "ownerName",
         format('%L', $5::text) AS "markerLiteral"`,
      [role, password, databaseName, currentUser, expectedRoleMarker],
    );
    const names = formatted.rows[0]!;
    const memberships = await admin.query<{ relationship: string; roleName: string }>(
      `SELECT 'member-of' AS relationship, parent.rolname AS "roleName"
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE member.rolname = $1
       UNION ALL
       SELECT 'has-member', member.rolname
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE parent.rolname = $1
       ORDER BY "roleName"`,
      [role],
    );
    if (memberships.rowCount !== 0) {
      throw new Error(
        `APP_DB_USER must not participate in PostgreSQL role memberships: ${memberships.rows.map((item) => `${item.relationship} ${item.roleName}`).join(", ")}`,
      );
    }

    const ownedObjects = await admin.query<{ objectName: string }>(
      `SELECT pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid) AS "objectName"
       FROM pg_shdepend AS dependency
       WHERE dependency.refclassid = 'pg_authid'::regclass
         AND dependency.refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1)
         AND dependency.deptype = 'o'
       LIMIT 20`,
      [role],
    );
    if (ownedObjects.rowCount !== 0) {
      throw new Error(
        `APP_DB_USER must not own database objects: ${ownedObjects.rows.map((item) => item.objectName).join(", ")}`,
      );
    }

    await admin.query("BEGIN");
    try {
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (exists.rowCount === 0) {
        await admin.query(
          `CREATE ROLE ${names.roleName} LOGIN PASSWORD ${names.passwordLiteral} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL 'infinity'`,
        );
        await admin.query(`COMMENT ON ROLE ${names.roleName} IS ${names.markerLiteral}`);
      } else {
        await admin.query(
          `ALTER ROLE ${names.roleName} WITH LOGIN PASSWORD ${names.passwordLiteral} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL 'infinity'`,
        );
      }
      if (
        process.env.NODE_ENV === "test" &&
        process.env.RUNTIME_ROLE_PROVISION_FAIL_AFTER_ROLE_MUTATION_FOR_TESTS === "yes"
      ) {
        throw new Error("Injected runtime-role provisioning failure");
      }
      await admin.query(`ALTER ROLE ${names.roleName} RESET ALL`);
      await admin.query(`ALTER ROLE ${names.roleName} IN DATABASE ${names.databaseName} RESET ALL`);
      await admin.query(`ALTER ROLE ${names.roleName} IN DATABASE ${names.databaseName} SET search_path TO pg_catalog, public`);
      const privilegeRevocations = await admin.query<{ statement: string }>(
        `SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %I', nspname, $1::text) AS statement
         FROM pg_namespace
         WHERE nspname <> 'information_schema'
           AND nspname !~ '^pg_'
         UNION ALL
         SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM %I', nspname, $1::text)
         FROM pg_namespace
         WHERE nspname <> 'information_schema'
           AND nspname !~ '^pg_'
         UNION ALL
         SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM %I', nspname, $1::text)
         FROM pg_namespace
         WHERE nspname <> 'information_schema'
           AND nspname !~ '^pg_'
         UNION ALL
         SELECT format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM %I', nspname, $1::text)
         FROM pg_namespace
         WHERE nspname <> 'information_schema'
           AND nspname !~ '^pg_'`,
        [role],
      );
      for (const revocation of privilegeRevocations.rows) {
        await admin.query(revocation.statement);
      }
      await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
      await admin.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${names.databaseName} FROM PUBLIC`);
      await admin.query(`REVOKE ALL PRIVILEGES ON DATABASE ${names.databaseName} FROM ${names.roleName}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${names.databaseName} TO ${names.roleName}`);
      await admin.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${names.roleName}`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO ${names.roleName}`);
      await admin.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${names.roleName}`);
      await admin.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${names.roleName}`);
      await admin.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC`);
      await admin.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${names.roleName}`);
      await admin.query(`GRANT SELECT ON TABLE administrators TO ${names.roleName}`);
      await admin.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
           administrator_sessions,
           administrator_login_rate_limits,
           images,
           pages,
           page_blocks,
           page_block_images,
           news,
           site_settings,
           site_setting_images,
           image_deletion_queue
         TO ${names.roleName}`,
      );
      await admin.query(
        `GRANT USAGE, SELECT ON SEQUENCE
           administrator_sessions_id_seq,
           images_id_seq,
           pages_id_seq,
           page_blocks_id_seq,
           news_id_seq,
           image_deletion_queue_id_seq
         TO ${names.roleName}`,
      );
      await admin.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${names.ownerName} IN SCHEMA public
         REVOKE ALL ON TABLES FROM ${names.roleName}`,
      );
      await admin.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${names.ownerName} IN SCHEMA public
         REVOKE ALL ON SEQUENCES FROM ${names.roleName}`,
      );
      await admin.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${names.ownerName} IN SCHEMA public
         REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
      );
      await admin.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${names.ownerName} IN SCHEMA public
         REVOKE ALL ON FUNCTIONS FROM ${names.roleName}`,
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  } finally {
    await admin.end();
  }
}
