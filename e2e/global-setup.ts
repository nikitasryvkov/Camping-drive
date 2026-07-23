import { mkdir, rm } from "node:fs/promises";

import { applyStage9Environment, stage9Administrator } from "./test-environment";

export default async function globalSetup(): Promise<void> {
  applyStage9Environment();

  const [{ database }, { runMigrations }, { hashPassword }, { config }] = await Promise.all([
    import("../server/src/database.js"),
    import("../server/src/migrations.js"),
    import("../server/src/password.js"),
    import("../server/src/config.js"),
  ]);

  if (!config.database.database.endsWith("_test")) {
    await database.end();
    throw new Error("Stage 9 E2E tests require a database name ending with _test");
  }

  try {
    await rm(config.uploadsDir, { recursive: true, force: true });
    await mkdir(config.uploadsDir, { recursive: true });
    await runMigrations();
    const passwordHash = await hashPassword(stage9Administrator.password);
    const updated = await database.query(
      `UPDATE administrators
       SET password_hash = $2,
           role = 'administrator'
       WHERE lower(login) = lower($1)`,
      [stage9Administrator.login, passwordHash],
    );
    if (updated.rowCount === 0) {
      await database.query(
        `INSERT INTO administrators (login, password_hash, role)
         VALUES ($1, $2, 'administrator')`,
        [stage9Administrator.login, passwordHash],
      );
    }
  } finally {
    await database.end();
  }
}
