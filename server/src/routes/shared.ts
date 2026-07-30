import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "../database.js";
import { NotFoundError, ValidationError } from "../errors.js";

export type ListResponse<T extends QueryResultRow> = {
  data: T[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export async function fetchOne<T extends QueryResultRow>(
  database: QueryExecutor,
  sql: string,
  values: unknown[],
  resource: string,
): Promise<T> {
  const result = await database.query<T>(sql, values);
  const row = result.rows[0];

  if (!row) {
    throw new NotFoundError(resource);
  }

  return row;
}

export async function fetchList<T extends QueryResultRow>(
  database: QueryExecutor,
  dataSql: string,
  countSql: string,
  filterValues: unknown[],
  limit: number,
  offset: number,
): Promise<ListResponse<T>> {
  const result = await database.query<{ data: T[]; total: string }>(
    `SELECT
       COALESCE((SELECT json_agg(paged) FROM (${dataSql}) AS paged), '[]'::json) AS data,
       (SELECT total FROM (${countSql}) AS counted) AS total`,
    [...filterValues, limit, offset],
  );
  const row = result.rows[0]!;
  const total = Number(row.total);

  return { data: row.data, pagination: { limit, offset, total } };
}

export function buildUpdateClause(
  valuesByColumn: Record<string, unknown>,
  startingParameter = 1,
): { clause: string; values: unknown[] } {
  const entries = Object.entries(valuesByColumn).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    throw new ValidationError("Request body must contain at least one editable field");
  }

  return {
    clause: entries
      .map(([column], index) => `${column} = $${startingParameter + index}`)
      .join(", "),
    values: entries.map(([, value]) => value),
  };
}
