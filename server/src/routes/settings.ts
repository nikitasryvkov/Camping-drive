import { Router } from "express";
import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "../database.js";
import { AppError, NotFoundError, ValidationError } from "../errors.js";
import { parseSiteSettingsValue, SITE_SETTINGS_KEY } from "../site-settings.js";
import {
  ensureAtLeastOneField,
  hasField,
  parseBody,
  parseOptionalQueryString,
  parsePagination,
  readBoolean,
  readDateTime,
  readJson,
  readString,
  rejectUnknownFields,
  type JsonObject,
} from "../validation.js";
import { buildUpdateClause, fetchList, fetchOne } from "./shared.js";

const keyPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/;

interface SettingRow extends QueryResultRow {
  key: string;
  value: unknown;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SettingSummaryRow extends QueryResultRow {
  key: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

const settingSummaryColumns = `
  key,
  description,
  is_public AS "isPublic",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const settingColumns = `
  key,
  value,
  description,
  is_public AS "isPublic",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export function createSettingsRouter(database: QueryExecutor): Router {
  const router = Router();

  router.get("/", async (request, response) => {
    const query = request.query as JsonObject;
    const { limit, offset } = parsePagination(query);
    const search = parseOptionalQueryString(query.search, "search", 100);
    const publicFilter = parsePublicFilter(query.public);
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (publicFilter !== undefined) {
      values.push(publicFilter);
      conditions.push(`is_public = $${values.length}`);
    }

    if (search) {
      values.push(`%${escapeLike(search)}%`);
      conditions.push(`(key ILIKE $${values.length} ESCAPE '\\' OR COALESCE(description, '') ILIKE $${values.length} ESCAPE '\\')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await fetchList<SettingSummaryRow>(
      database,
      `SELECT ${settingSummaryColumns} FROM site_settings ${where} ORDER BY key LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      `SELECT count(*)::text AS total FROM site_settings ${where}`,
      values,
      limit,
      offset,
    );
    response.json(result);
  });

  router.get("/:key", async (request, response) => {
    const key = validateKey(request.params.key ?? "");
    const setting = await getSetting(database, key);
    response.json({ data: setting });
  });

  router.put("/:key", async (request, response) => {
    const key = validateKey(request.params.key ?? "");
    const input = parseSettingInput(request.body, true, key);
    const values = [
      JSON.stringify(input.value),
      input.description ?? null,
      input.isPublic ?? true,
    ];
    if (input.expectedUpdatedAt === null) {
      const result = await database.query<SettingRow>(
        `INSERT INTO site_settings (key, value, description, is_public)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (key) DO NOTHING
         RETURNING ${settingColumns}`,
        [key, ...values],
      );
      if (result.rowCount === 0) {
        throw new AppError(409, "EDIT_CONFLICT", "Site setting already exists");
      }
      response.json({ data: result.rows[0] });
      return;
    }

    const result = await database.query<SettingRow>(
      `UPDATE site_settings
       SET value = $2::jsonb, description = $3, is_public = $4
       WHERE key = $1 AND updated_at = $5::timestamptz
       RETURNING ${settingColumns}`,
      [key, ...values, input.expectedUpdatedAt],
    );
    if (result.rowCount === 0) {
      const exists = await database.query("SELECT 1 FROM site_settings WHERE key = $1", [key]);
      if (exists.rowCount === 0) throw new NotFoundError("Site setting");
      throw new AppError(409, "EDIT_CONFLICT", "Site setting was changed in another browser session");
    }

    response.json({ data: result.rows[0] });
  });

  router.patch("/:key", async (request, response) => {
    const key = validateKey(request.params.key ?? "");
    const input = parseSettingInput(request.body, false, key);
    const update = buildUpdateClause({
      value: input.hasValue ? JSON.stringify(input.value) : undefined,
      description: input.description,
      is_public: input.isPublic,
    });
    const result = await database.query<SettingRow>(
      `UPDATE site_settings SET ${update.clause}
       WHERE key = $${update.values.length + 1}
         AND updated_at = $${update.values.length + 2}::timestamptz
       RETURNING ${settingColumns}`,
      [...update.values, key, input.expectedUpdatedAt],
    );
    const setting = result.rows[0];
    if (!setting) {
      const exists = await database.query("SELECT 1 FROM site_settings WHERE key = $1", [key]);
      if (exists.rowCount === 0) throw new NotFoundError("Site setting");
      throw new AppError(409, "EDIT_CONFLICT", "Site settings were changed in another browser session");
    }
    response.json({ data: setting });
  });

  router.delete("/:key", async (request, response) => {
    const key = validateKey(request.params.key ?? "");
    const expectedUpdatedAt = readDateTime(
      { expectedUpdatedAt: request.query.expectedUpdatedAt },
      "expectedUpdatedAt",
      { required: true },
    )!;
    const result = await database.query(
      "DELETE FROM site_settings WHERE key = $1 AND updated_at = $2::timestamptz",
      [key, expectedUpdatedAt],
    );

    if (result.rowCount === 0) {
      const exists = await database.query("SELECT 1 FROM site_settings WHERE key = $1", [key]);
      if (exists.rowCount === 0) throw new NotFoundError("Site setting");
      throw new AppError(409, "EDIT_CONFLICT", "Site setting was changed in another browser session");
    }

    response.status(204).send();
  });

  return router;
}

async function getSetting(database: QueryExecutor, key: string): Promise<SettingRow> {
  return fetchOne<SettingRow>(
    database,
    `SELECT ${settingColumns} FROM site_settings WHERE key = $1`,
    [key],
    "Site setting",
  );
}

function parseSettingInput(bodyValue: unknown, replace: boolean, key: string) {
  const body = parseBody(bodyValue);
  rejectUnknownFields(body, ["value", "description", "isPublic", "expectedUpdatedAt"]);
  ensureAtLeastOneField(body);
  if (Object.keys(body).every((field) => field === "expectedUpdatedAt")) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "body", message: "At least one setting field must be changed" }],
    });
  }
  const hasValue = hasField(body, "value");

  if (replace && !hasValue) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "value", message: "Field is required" }],
    });
  }

  const value = hasValue ? readJson(body, "value") : undefined;
  const isPublic = readBoolean(body, "isPublic");
  const expectedUpdatedAt = readDateTime(body, "expectedUpdatedAt", {
    required: true,
    nullable: replace,
  });
  if (key === SITE_SETTINGS_KEY && isPublic === false) {
    throw new ValidationError("The public site settings cannot be private", {
      fields: [{ field: "isPublic", message: "Must be true for the site setting" }],
    });
  }

  return {
    hasValue,
    value: hasValue && key === SITE_SETTINGS_KEY ? parseSiteSettingsValue(value) : value,
    description: readString(body, "description", { nullable: true, maxLength: 500 }),
    isPublic,
    expectedUpdatedAt,
  };
}

function validateKey(value: string): string {
  if (value.length === 0 || value.length > 100 || !keyPattern.test(value)) {
    throw new ValidationError("The request contains invalid data", {
      fields: [{ field: "key", message: "Use lowercase dot-separated words and numbers" }],
    });
  }

  return value;
}

function parsePublicFilter(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new ValidationError("The request contains invalid data", {
    fields: [{ field: "public", message: "Must be true or false" }],
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
