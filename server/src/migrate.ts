import { provisionRuntimeDatabaseRole } from "./provision-runtime-role.js";
import { runMigrations } from "./migrations.js";
import { validateProductionData } from "./validate-production-data.js";

await runMigrationsWithStartupRetry();
await validateProductionData();
await provisionRuntimeDatabaseRole();
console.log("Database migrations and runtime-role grants are complete");

async function runMigrationsWithStartupRetry(): Promise<void> {
  const transientCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ETIMEDOUT", "57P03"]);
  const maximumAttempts = 30;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await runMigrations();
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (!transientCodes.has(code) || attempt === maximumAttempts) throw error;
      console.warn(`Database is not stable yet (${code}); migration attempt ${attempt}/${maximumAttempts} will be retried`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
