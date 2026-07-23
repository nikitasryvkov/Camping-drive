import assert from "node:assert/strict";
import { describe, it } from "node:test";

import express from "express";

import type { QueryExecutor } from "../src/database.js";
import { hashPassword } from "../src/password.js";

process.env.NODE_ENV = "test";
process.env.PGDATABASE ??= "auth_rate_limit_test";
process.env.PGUSER ??= "auth_rate_limit_test";
process.env.PGPASSWORD ??= "auth_rate_limit_test";

const [{ createAuthRouter, DatabaseLoginRateLimiter }, { errorHandler }] = await Promise.all([
  import("../src/auth.js"),
  import("../src/errors.js"),
]);

describe("administrator login rate limiting", () => {
  it("fails fast when the password-verification worker is occupied", async () => {
    let releaseLookup!: () => void;
    let lookupStarted!: () => void;
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const lookupSignal = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    let queryCount = 0;
    const fakeDatabase = {
      async query(sql: string) {
        if (sql.includes("FROM administrators")) {
          queryCount += 1;
          if (queryCount === 1) {
            lookupStarted();
            await lookupGate;
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as unknown as QueryExecutor;
    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRouter(fakeDatabase));
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;
    const originalConsoleWarn = console.warn;

    try {
      console.warn = () => undefined;
      const occupiedRequest = login(url, "wrong password");
      await lookupSignal;
      const busyResponse = await login(url, "wrong password");
      assert.equal(busyResponse.status, 503);
      assert.equal(busyResponse.headers.get("retry-after"), "2");
      assert.equal((await busyResponse.json()).error.code, "PASSWORD_VERIFICATION_BUSY");
      releaseLookup();
      assert.equal((await occupiedRequest).status, 401);
    } finally {
      console.warn = originalConsoleWarn;
      releaseLookup();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rolls back both database scopes when the second reservation fails", async () => {
    const statements: string[] = [];
    let inserts = 0;
    const client = {
      async query(sql: string) {
        statements.push(sql.trim());
        if (sql.includes("INSERT INTO administrator_login_rate_limits")) {
          inserts += 1;
          if (inserts === 2) throw new Error("second scope failed");
          return { rows: [{ windowStartedAt: new Date().toISOString() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {
        statements.push("RELEASE");
      },
    };
    const fakeDatabase = {
      connect: async () => client,
    } as unknown as QueryExecutor;
    const limiter = new DatabaseLoginRateLimiter(fakeDatabase);

    await assert.rejects(
      () => limiter.reserve("198.51.100.20", "administrator"),
      /second scope failed/,
    );
    assert.ok(statements.includes("BEGIN"));
    assert.ok(statements.includes("ROLLBACK"));
    assert.equal(statements.at(-1), "RELEASE");
    assert.ok(!statements.includes("COMMIT"));
  });

  it("releases only the failed request lease after infrastructure errors", async () => {
    const password = "correct administrator password";
    const passwordHash = await hashPassword(password);
    let remainingDatabaseFailures = 5;
    const fakeDatabase = {
      async query(sql: string) {
        if (sql.includes("FROM administrators")) {
          if (remainingDatabaseFailures > 0) {
            remainingDatabaseFailures -= 1;
            throw new Error("Temporary database failure");
          }

          return {
            rows: [
              {
                id: "1",
                login: "administrator",
                role: "administrator",
                passwordHash,
              },
            ],
          };
        }

        return { rows: [] };
      },
    } as unknown as QueryExecutor;

    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRouter(fakeDatabase));
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;
    const originalConsoleError = console.error;

    try {
      console.error = () => undefined;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await login(url, password);
        assert.equal(response.status, 500);
      }

      const recoveredResponse = await login(url, password);
      assert.equal(recoveredResponse.status, 200);
      assert.equal((await recoveredResponse.json()).data.administrator.role, "administrator");
    } finally {
      console.error = originalConsoleError;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

function login(url: string, password: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "administrator", password }),
  });
}
