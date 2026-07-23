import { createHash, randomBytes } from "node:crypto";

import { Router, type Request, type RequestHandler } from "express";

import { CapacityLimiter } from "./capacity-limiter.js";
import { config } from "./config.js";
import type { QueryExecutor } from "./database.js";
import { AppError } from "./errors.js";
import { verifyPasswordOrDummy } from "./password.js";
import { parseBody, readString, rejectUnknownFields } from "./validation.js";

const sessionCookieName = config.nodeEnv === "production"
  ? "__Host-camping_drive_admin_session"
  : "camping_drive_admin_session";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const loginAttemptWindowMs = 15 * 60 * 1_000;
const maximumLoginAttemptsPerCredential = 5;
const maximumLoginAttemptsPerIp = 20;
const maximumRateLimitBuckets = 10_000;
const passwordVerificationCapacity = new CapacityLimiter(
  config.authentication.passwordVerificationConcurrency,
);

type AdministratorRow = {
  id: string;
  login: string;
  role: "administrator";
  passwordHash: string;
};

type AuthenticatedAdministratorRow = Omit<AdministratorRow, "passwordHash"> & {
  expiresAt: string;
};

type LoginAttempt = {
  reservations: Array<{ id: number; timestamp: number }>;
};

type LoginReservation = {
  id: number;
  keys: string[];
};

type LoginRateLimitDecision =
  | { allowed: true; reservation: LoginReservation }
  | { allowed: false; retryAfterSeconds: number };

export type Administrator = Pick<AdministratorRow, "id" | "login" | "role">;

class InMemoryLoginRateLimiter {
  private readonly attempts = new Map<string, LoginAttempt>();
  private nextReservationId = 1;

  reserve(ip: string, login: string): LoginRateLimitDecision {
    const now = Date.now();
    const normalizedLoginHash = createHash("sha256")
      .update(login.toLocaleLowerCase("en-US"))
      .digest("hex");
    const scopes = [
      { key: `ip:${ip}`, maximum: maximumLoginAttemptsPerIp },
      {
        key: `credential:${normalizedLoginHash}`,
        maximum: maximumLoginAttemptsPerCredential,
      },
    ];

    this.ensureCapacity(scopes.map((scope) => scope.key), now);

    let retryAfterSeconds: number | undefined;
    for (const scope of scopes) {
      const attempt = this.getActiveAttempt(scope.key, now);
      if (attempt.reservations.length >= scope.maximum) {
        const scopeRetryAfter = Math.max(
          1,
          Math.ceil(
            (loginAttemptWindowMs - (now - attempt.reservations[0]!.timestamp)) / 1_000,
          ),
        );
        retryAfterSeconds = Math.max(retryAfterSeconds ?? 0, scopeRetryAfter);
      }
    }

    if (retryAfterSeconds !== undefined) {
      return { allowed: false, retryAfterSeconds };
    }

    // This runs before the first asynchronous operation in the login handler, so
    // concurrent requests cannot all pass an empty-bucket check.
    const reservation: LoginReservation = {
      id: this.nextReservationId,
      keys: scopes.map((scope) => scope.key),
    };
    this.nextReservationId = (this.nextReservationId % Number.MAX_SAFE_INTEGER) + 1;
    for (const scope of scopes) {
      const attempt = this.getActiveAttempt(scope.key, now);
      attempt.reservations.push({ id: reservation.id, timestamp: now });
      this.touch(scope.key, attempt);
    }

    return { allowed: true, reservation };
  }

  release(reservation: LoginReservation): void {
    for (const key of reservation.keys) {
      const attempt = this.attempts.get(key);
      if (!attempt) {
        continue;
      }

      attempt.reservations = attempt.reservations.filter(
        (entry) => entry.id !== reservation.id,
      );
      if (attempt.reservations.length === 0) {
        this.attempts.delete(key);
      } else {
        this.touch(key, attempt);
      }
    }
  }

  clear(reservation: LoginReservation): void {
    for (const key of reservation.keys) {
      this.attempts.delete(key);
    }
  }

  private getActiveAttempt(key: string, now: number): LoginAttempt {
    const attempt = this.attempts.get(key) ?? { reservations: [] };
    attempt.reservations = attempt.reservations.filter(
      (reservation) => now - reservation.timestamp < loginAttemptWindowMs,
    );
    return attempt;
  }

  private touch(key: string, attempt: LoginAttempt): void {
    this.attempts.delete(key);
    this.attempts.set(key, attempt);
  }

  private ensureCapacity(pendingKeys: string[], now: number): void {
    const missingKeyCount = pendingKeys.filter((key) => !this.attempts.has(key)).length;
    if (this.attempts.size + missingKeyCount <= maximumRateLimitBuckets) {
      return;
    }

    for (const [key, attempt] of this.attempts) {
      attempt.reservations = attempt.reservations.filter(
        (reservation) => now - reservation.timestamp < loginAttemptWindowMs,
      );
      if (attempt.reservations.length === 0) {
        this.attempts.delete(key);
      }
    }

    while (this.attempts.size + missingKeyCount > maximumRateLimitBuckets) {
      const oldestKey = this.attempts.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.attempts.delete(oldestKey);
    }
  }
}

export function createAuthRouter(database: QueryExecutor): Router {
  const router = Router();
  const loginRateLimiter = createLoginRateLimiter(database);

  router.post("/login", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");

    const body = parseBody(request.body);
    rejectUnknownFields(body, ["login", "password"]);
    const login = readString(body, "login", {
      required: true,
      minLength: 3,
      maxLength: 100,
    })!;
    const password = readString(body, "password", {
      required: true,
      minLength: 1,
      maxLength: 1_024,
      normalize: (value) => value,
    })!;

    const clientIp = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const rateLimitDecision = await loginRateLimiter.reserve(clientIp, login);
    if (!rateLimitDecision.allowed) {
      response.setHeader("Retry-After", String(rateLimitDecision.retryAfterSeconds));
      throw new AppError(
        429,
        "TOO_MANY_LOGIN_ATTEMPTS",
        "Too many login attempts. Try again later",
      );
    }

    let administrator: AdministratorRow | undefined;
    let passwordMatches = false;
    const releasePasswordVerification = passwordVerificationCapacity.tryAcquire();
    if (!releasePasswordVerification) {
      await loginRateLimiter.release(rateLimitDecision.reservation);
      response.setHeader("Retry-After", "2");
      throw new AppError(
        503,
        "PASSWORD_VERIFICATION_BUSY",
        "Authentication is busy; retry shortly",
      );
    }
    try {
      const result = await database.query<AdministratorRow>(
        `SELECT
           id::text,
           login,
           role,
           password_hash AS "passwordHash"
         FROM administrators
         WHERE lower(login) = lower($1)
         LIMIT 1`,
        [login],
      );
      administrator = result.rows[0];
      passwordMatches = await verifyPasswordOrDummy(password, administrator?.passwordHash);
    } catch (error) {
      await loginRateLimiter.release(rateLimitDecision.reservation);
      throw error;
    } finally {
      releasePasswordVerification();
    }

    if (!administrator || !passwordMatches) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid login or password");
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + config.authentication.sessionTtlMs);

    await database.query("DELETE FROM administrator_sessions WHERE expires_at <= now()");
    await database.query(
      `INSERT INTO administrator_sessions (administrator_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [administrator.id, tokenHash, expiresAt.toISOString()],
    );
    await loginRateLimiter.clear(rateLimitDecision.reservation);

    response.cookie(sessionCookieName, token, cookieOptions(request, expiresAt));
    response.json({
      data: {
        administrator: toPublicAdministrator(administrator),
        expiresAt: expiresAt.toISOString(),
      },
    });
  });

  router.get("/session", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const administrator = await findAuthenticatedAdministrator(database, request);

    if (!administrator) {
      response.json({ data: { authenticated: false } });
      return;
    }

    response.json({
      data: {
        authenticated: true,
        administrator: toPublicAdministrator(administrator),
        expiresAt: administrator.expiresAt,
      },
    });
  });

  router.post("/logout", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const token = readSessionToken(request);

    if (token) {
      await database.query("DELETE FROM administrator_sessions WHERE token_hash = $1", [
        hashSessionToken(token),
      ]);
    }

    response.clearCookie(sessionCookieName, clearCookieOptions(request));
    response.status(204).end();
  });

  return router;
}

export function createRequireAdministrator(database: QueryExecutor): RequestHandler {
  return async (request, response, next) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      const administrator = await findAuthenticatedAdministrator(database, request);

      if (!administrator) {
        throw new AppError(401, "AUTHENTICATION_REQUIRED", "Administrator login required");
      }

      response.locals.administrator = toPublicAdministrator(administrator);
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function findAuthenticatedAdministrator(
  database: QueryExecutor,
  request: Request,
): Promise<AuthenticatedAdministratorRow | undefined> {
  const token = readSessionToken(request);
  if (!token) {
    return undefined;
  }

  const result = await database.query<AuthenticatedAdministratorRow>(
    `UPDATE administrator_sessions AS session
     SET last_seen_at = now()
     FROM administrators AS administrator
     WHERE session.token_hash = $1
       AND session.expires_at > now()
       AND administrator.id = session.administrator_id
       AND administrator.role = 'administrator'
     RETURNING
       administrator.id::text,
       administrator.login,
       administrator.role,
       session.expires_at AS "expiresAt"`,
    [hashSessionToken(token)],
  );

  return result.rows[0];
}

function readSessionToken(request: Request): string | undefined {
  const matches = (request.headers.cookie ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(`${sessionCookieName}=`));

  if (matches.length !== 1) {
    return undefined;
  }

  const token = matches[0]!.slice(sessionCookieName.length + 1);
  return tokenPattern.test(token) ? token : undefined;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(request: Request, expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.nodeEnv === "production" || request.secure,
    path: "/",
    expires: expiresAt,
  };
}

function clearCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.nodeEnv === "production" || request.secure,
    path: "/",
  };
}

type AsyncLoginRateLimiter = {
  reserve(ip: string, login: string): Promise<LoginRateLimitDecision>;
  release(reservation: LoginReservation): Promise<void>;
  clear(reservation: LoginReservation): Promise<void>;
};

function createLoginRateLimiter(database: QueryExecutor): AsyncLoginRateLimiter {
  if (!database.connect) {
    const fallback = new InMemoryLoginRateLimiter();
    return {
      reserve: async (ip, login) => fallback.reserve(ip, login),
      release: async (reservation) => fallback.release(reservation),
      clear: async (reservation) => fallback.clear(reservation),
    };
  }

  return new DatabaseLoginRateLimiter(database);
}

export class DatabaseLoginRateLimiter implements AsyncLoginRateLimiter {
  constructor(private readonly database: QueryExecutor) {}

  async reserve(ip: string, login: string): Promise<LoginRateLimitDecision> {
    const normalizedLoginHash = createHash("sha256")
      .update(login.toLocaleLowerCase("en-US"))
      .digest("hex");
    const scopes = [
      { key: hashRateLimitScope(`ip:${ip}`), maximum: maximumLoginAttemptsPerIp },
      { key: hashRateLimitScope(`credential:${normalizedLoginHash}`), maximum: maximumLoginAttemptsPerCredential },
    ];
    const reservedKeys: string[] = [];
    const client = await this.database.connect!();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM administrator_login_rate_limits
         WHERE window_started_at <= now() - ($1::bigint * interval '1 millisecond')`,
        [loginAttemptWindowMs * 2],
      );

      for (const scope of scopes) {
        const result = await client.query<{ windowStartedAt: string }>(
          `INSERT INTO administrator_login_rate_limits (scope_hash, window_started_at, attempts)
           VALUES ($1, now(), 1)
           ON CONFLICT (scope_hash) DO UPDATE SET
             window_started_at = CASE
               WHEN administrator_login_rate_limits.window_started_at <= now() - ($3::bigint * interval '1 millisecond') THEN now()
               ELSE administrator_login_rate_limits.window_started_at
             END,
             attempts = CASE
               WHEN administrator_login_rate_limits.window_started_at <= now() - ($3::bigint * interval '1 millisecond') THEN 1
               ELSE administrator_login_rate_limits.attempts + 1
             END
           WHERE administrator_login_rate_limits.window_started_at <= now() - ($3::bigint * interval '1 millisecond')
              OR administrator_login_rate_limits.attempts < $2
           RETURNING window_started_at AS "windowStartedAt"`,
          [scope.key, scope.maximum, loginAttemptWindowMs],
        );

        if (result.rowCount === 0) {
          const retry = await client.query<{ retryAfterSeconds: number }>(
            `SELECT GREATEST(
               1,
               ceil(extract(epoch FROM (window_started_at + ($2::bigint * interval '1 millisecond') - now())))
             )::integer AS "retryAfterSeconds"
             FROM administrator_login_rate_limits
             WHERE scope_hash = $1`,
            [scope.key, loginAttemptWindowMs],
          );
          await client.query("ROLLBACK");
          return { allowed: false, retryAfterSeconds: retry.rows[0]?.retryAfterSeconds ?? 1 };
        }
        reservedKeys.push(scope.key);
      }
      await client.query("COMMIT");
      return { allowed: true, reservation: { id: 0, keys: reservedKeys } };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async release(reservation: LoginReservation): Promise<void> {
    if (reservation.keys.length === 0) return;
    await this.database.query(
      `WITH removed AS (
         DELETE FROM administrator_login_rate_limits
         WHERE scope_hash = ANY($1::char(64)[]) AND attempts <= 1
       )
       UPDATE administrator_login_rate_limits
       SET attempts = attempts - 1
       WHERE scope_hash = ANY($1::char(64)[]) AND attempts > 1`,
      [reservation.keys],
    );
  }

  async clear(reservation: LoginReservation): Promise<void> {
    if (reservation.keys.length === 0) return;
    await this.database.query(
      "DELETE FROM administrator_login_rate_limits WHERE scope_hash = ANY($1::char(64)[])",
      [reservation.keys],
    );
  }
}

function hashRateLimitScope(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPublicAdministrator(administrator: Administrator): Administrator {
  return {
    id: administrator.id,
    login: administrator.login,
    role: administrator.role,
  };
}
