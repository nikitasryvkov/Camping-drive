import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { config } from "./config.js";

const timestampWithTimeZoneType = 1184;
types.setTypeParser(timestampWithTimeZoneType, (value) =>
  value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
);

export const database = new Pool({
  ...config.database,
  options: "-c search_path=pg_catalog,public",
  application_name: "camping-drive-backend",
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  query_timeout: 4_000,
  statement_timeout: 4_000,
});

export function createMigrationDatabase(): Pool {
  return new Pool({
    ...config.database,
    // Migrations create unqualified application objects, so their first
    // creation schema must be public. PUBLIC cannot create there and this
    // connection uses the dedicated database owner.
    options: "-c search_path=public,pg_catalog",
    application_name: "camping-drive-migrations",
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 130_000,
    statement_timeout: 120_000,
  });
}

export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
  connect?(): Promise<PoolClient>;
}

database.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

let pendingConnectionCheck: Promise<void> | undefined;

export function checkDatabaseConnection(): Promise<void> {
  pendingConnectionCheck ??= database
    .query("SELECT 1")
    .then(() => undefined)
    .finally(() => {
      pendingConnectionCheck = undefined;
    });

  return pendingConnectionCheck;
}
