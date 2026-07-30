import { Router } from "express";
import type { QueryResultRow } from "pg";

import type { QueryExecutor } from "../database.js";
import { DEFAULT_SITE_SETTINGS, parseSiteSettingsValue, SITE_SETTINGS_KEY } from "../site-settings.js";

interface PublicSettingsRow extends QueryResultRow {
  value: unknown;
  updatedAt: string;
  logoUrl: string | null;
}

export function createPublicSettingsRouter(database: QueryExecutor): Router {
  const router = Router();

  router.get("/", async (_request, response) => {
    const result = await database.query<PublicSettingsRow>(
      `SELECT setting.value,
              setting.updated_at AS "updatedAt",
              CASE
                WHEN image.id IS NULL THEN NULL
                ELSE '/uploads/' || COALESCE(
                  NULLIF(image.variants->'thumbnail'->>'storagePath', ''),
                  NULLIF(image.variants->'medium'->>'storagePath', ''),
                  image.storage_path
                )
              END AS "logoUrl"
         FROM site_settings AS setting
         LEFT JOIN site_setting_images AS reference ON reference.setting_key = setting.key
         LEFT JOIN images AS image ON image.id = reference.image_id
        WHERE setting.key = $1 AND setting.is_public = true`,
      [SITE_SETTINGS_KEY],
    );

    const row = result.rows[0];
    let value = DEFAULT_SITE_SETTINGS;
    if (row) {
      try {
        value = parseSiteSettingsValue(row.value);
      } catch (error) {
        console.error("Stored public site settings are invalid; defaults are being used", error);
      }
    }

    response.json({
      data: {
        ...value,
        logoUrl: row?.logoUrl ?? "/logo-kemping-drive.png",
        updatedAt: row?.updatedAt ?? null,
      },
    });
  });

  return router;
}
