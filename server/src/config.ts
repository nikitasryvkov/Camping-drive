import path from "node:path";
import {
  accessSync,
  constants as fsConstants,
  readFileSync,
  statSync,
} from "node:fs";

import dotenv from "dotenv";

import {
  ensureNodeEnvironment,
  ensureProductionDatabaseSecret,
  ensurePublicSiteOrigin,
  validatePublicIndexTemplate,
} from "./config-validation.js";

dotenv.config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

function readRequired(...names: string[]): string {
  const value = names.map((name) => process.env[name]?.trim()).find(Boolean);

  if (!value) {
    throw new Error(`Environment variable ${names.join(" or ")} is required`);
  }

  return value;
}

function readPort(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  const value = rawValue ? Number(rawValue) : fallback;

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Environment variable ${name} must be a valid TCP port`);
  }

  return value;
}

function readInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const rawValue = process.env[name]?.trim();
  const value = rawValue ? Number(rawValue) : fallback;

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `Environment variable ${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return value;
}

function readOrigins(): readonly string[] {
  const configured = process.env.PUBLIC_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const values = configured?.length
    ? configured
    : process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:5180", "http://127.0.0.1:5180", "http://127.0.0.1:5181"];

  if (values.length === 0) {
    throw new Error("Environment variable PUBLIC_ORIGINS is required in production");
  }

  return Object.freeze(values.map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`PUBLIC_ORIGINS contains an invalid URL: ${value}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value.replace(/\/$/, "")) {
      throw new Error(`PUBLIC_ORIGINS must contain origins without paths: ${value}`);
    }
    return parsed.origin;
  }));
}

const uploadsDir = path.resolve(process.env.UPLOADS_DIR?.trim() || "uploads");
const nodeEnv = process.env.NODE_ENV?.trim() || "development";
ensureNodeEnvironment(nodeEnv);
const publicSiteUrl = readPublicSiteUrl(nodeEnv);
const publicIndexPath = readPublicIndexPath(nodeEnv);
const publicOrigins = readOrigins();
const databasePassword = readRequired("PGPASSWORD", "POSTGRES_PASSWORD");
ensurePublicSiteOrigin(nodeEnv, publicSiteUrl, publicOrigins);
ensureProductionDatabaseSecret(nodeEnv, "database password", databasePassword);

export const config = Object.freeze({
  nodeEnv,
  port: readPort("PORT", 3000),
  uploadsDir,
  images: Object.freeze({
    maxUploadBytes: readInteger("IMAGE_MAX_UPLOAD_MB", 15, 1, 15) * 1024 * 1024,
    maxInputPixels: readInteger("IMAGE_MAX_INPUT_MEGAPIXELS", 40, 1, 100) * 1_000_000,
    processingConcurrency: readInteger("IMAGE_PROCESSING_CONCURRENCY", 1, 1, 2),
  }),
  authentication: Object.freeze({
    sessionTtlMs: readInteger("ADMIN_SESSION_TTL_HOURS", 12, 1, 720) * 60 * 60 * 1_000,
    passwordVerificationConcurrency: readInteger("PASSWORD_VERIFICATION_CONCURRENCY", 1, 1, 4),
  }),
  network: Object.freeze({
    trustProxyHops: readInteger("TRUST_PROXY_HOPS", 0, 0, 10),
    publicOrigins,
  }),
  publicSiteUrl,
  publicIndexPath,
  database: Object.freeze({
    host: process.env.PGHOST?.trim() || "127.0.0.1",
    port: readPort("PGPORT", 5432),
    database: readRequired("PGDATABASE", "POSTGRES_DB"),
    user: readRequired("PGUSER", "POSTGRES_USER"),
    password: databasePassword,
  }),
});

function readPublicSiteUrl(environment: string): string | undefined {
  const rawValue = process.env.PUBLIC_SITE_URL?.trim();
  if (!rawValue) {
    if (environment === "production") {
      throw new Error("Environment variable PUBLIC_SITE_URL is required in production");
    }
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be an absolute URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    (environment === "production" && parsed.protocol !== "https:") ||
    parsed.origin !== rawValue.replace(/\/$/, "")
  ) {
    throw new Error("PUBLIC_SITE_URL must be an HTTPS origin without a path in production");
  }
  return parsed.origin;
}

function readPublicIndexPath(environment: string): string | undefined {
  const rawValue = process.env.PUBLIC_INDEX_PATH?.trim();
  if (!rawValue) {
    if (environment === "production") {
      throw new Error("Environment variable PUBLIC_INDEX_PATH is required in production");
    }
    return undefined;
  }
  const resolved = path.resolve(rawValue);
  if (environment === "production") {
    try {
      accessSync(resolved, fsConstants.R_OK);
      if (!statSync(resolved).isFile()) {
        throw new Error("not a file");
      }
      validatePublicIndexTemplate(readFileSync(resolved, "utf8"));
    } catch {
      throw new Error("PUBLIC_INDEX_PATH must point to a readable production index.html with SSR markers");
    }
  }
  return resolved;
}
