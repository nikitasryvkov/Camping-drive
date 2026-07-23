import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const npmCli = process.env.npm_execpath
  ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const stage9Directory = fileURLToPath(new URL("../.stage9", import.meta.url));
const stage9LockPort = 55_431;
const composeArguments = ["compose", "-p", "camping-drive-stage9", "-f", "compose.test.yaml"];
const testEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  PORT: "3010",
  PGHOST: "127.0.0.1",
  PGPORT: "55432",
  PGDATABASE: "camping_drive_stage9_test",
  PGUSER: "camping_drive_stage9",
  PGPASSWORD: "stage9-local-test-password",
  UPLOADS_DIR: fileURLToPath(new URL("../.stage9/uploads", import.meta.url)),
  ADMIN_SESSION_TTL_HOURS: "1",
  TRUST_PROXY_HOPS: "0",
};

const stage9Lock = await acquireRunLock();
try {
  await main();
} finally {
  await closeRunLock(stage9Lock);
}

async function main() {
  let databaseStartAttempted = false;
  let testError;

  try {
    await run("Проверка Docker Compose", "docker", ["compose", "version"]);
    databaseStartAttempted = true;
    await run("Очистка предыдущего test-запуска", "docker", [
      ...composeArguments, "down", "--volumes",
    ]);
    await run("Запуск изолированной test-БД", "docker", [
      ...composeArguments, "up", "-d", "--wait", "--force-recreate",
    ]);

    await run("Backend unit-тесты", process.execPath, [npmCli, "run", "test:backend"]);
    await run("Тест обновления заполненной БД", process.execPath, [npmCli, "run", "test:backend:migrations"], testEnvironment);
    await run("Backend integration-тест с покрытием", process.execPath, [npmCli, "run", "test:backend:integration:coverage"], testEnvironment);
    await run("Desktop и mobile E2E-тесты", process.execPath, [npmCli, "run", "test:e2e"], testEnvironment);
    await run("Production-сборка", process.execPath, [npmCli, "run", "build"]);
  } catch (error) {
    testError = error;
  }

  const cleanupErrors = [];
  try {
    if (databaseStartAttempted) {
      await run("Остановка test-БД", "docker", [
        ...composeArguments, "down", "--volumes",
      ]);
    }
  } catch (error) {
    cleanupErrors.push(error);
  } finally {
    try {
      await rm(stage9Directory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (testError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [testError, ...cleanupErrors].filter(Boolean),
      "Проверки этапа 9 или очистка тестового окружения завершились с ошибкой",
    );
  }

  console.log("\nЭтап 9: все проверки и очистка тестового окружения успешно пройдены.");
}

async function acquireRunLock() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error && typeof error === "object" && error.code === "EADDRINUSE") {
        reject(new Error(`Другой запуск этапа 9 уже работает или порт блокировки ${stage9LockPort} занят`, { cause: error }));
      } else {
        reject(error);
      }
    });
    server.listen({ host: "127.0.0.1", port: stage9LockPort, exclusive: true }, () => resolve(server));
  });
}

function closeRunLock(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function run(label, command, args, env = process.env, rejectOnFailure = true) {
  console.log(`\n=== ${label} ===`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${label} завершилась с кодом ${code ?? `signal ${signal}`}`);
      if (rejectOnFailure) reject(error);
      else {
        console.error(error.message);
        resolve();
      }
    });
  });
}
