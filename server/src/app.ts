import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import express, { type RequestHandler } from "express";

import { createAuthRouter, createRequireAdministrator } from "./auth.js";
import { config } from "./config.js";
import { checkDatabaseConnection, database, type QueryExecutor } from "./database.js";
import { AppError, errorHandler } from "./errors.js";
import { createImagesRouter } from "./routes/images.js";
import { createNewsRouter } from "./routes/news.js";
import { createPagesRouter } from "./routes/pages.js";
import { createPublicPagesRouter } from "./routes/public-pages.js";
import { createPublicNewsRouter } from "./routes/public-news.js";
import { createPublicHtmlRouter } from "./routes/public-html.js";
import { createPublicSettingsRouter } from "./routes/public-settings.js";
import { createSettingsRouter } from "./routes/settings.js";
import { validateJsonNumberTokens } from "./validation.js";
import { MAX_BUILDER_PAYLOAD_BYTES } from "../../shared/page-limits.js";

const rawJsonBodies = new WeakMap<object, string>();

export function createApp(queryExecutor: QueryExecutor = database) {
  const app = express();

  app.disable("x-powered-by");
  app.enable("case sensitive routing");
  app.enable("strict routing");
  app.set("trust proxy", config.network.trustProxyHops);
  app.use("/api", requireCanonicalApiPath());
  app.use("/api", requireTrustedBrowserOrigin());

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/health/ready", async (_request, response) => {
    try {
      await Promise.all([
        checkDatabaseConnection(),
        access(config.uploadsDir, fsConstants.W_OK),
        config.publicIndexPath ? access(config.publicIndexPath, fsConstants.R_OK) : Promise.resolve(),
      ]);
      response.json({
        status: "ready",
        database: "connected",
        uploads: "writable",
      });
    } catch (error) {
      console.error("Backend readiness check failed", error);
      response.status(503).json({ status: "unavailable" });
    }
  });

  app.use("/api/auth", ...createJsonBodyParser(16 * 1024), createAuthRouter(queryExecutor));
  app.use("/api/public/pages", createPublicPagesRouter(queryExecutor));
  app.use("/api/public/news", createPublicNewsRouter(queryExecutor));
  app.use("/api/public/settings", createPublicSettingsRouter(queryExecutor));
  app.use("/internal/render", createPublicHtmlRouter(queryExecutor));

  const requireAdministrator = createRequireAdministrator(queryExecutor);
  const protectedJsonBodyParser = createJsonBodyParser(MAX_BUILDER_PAYLOAD_BYTES);
  app.use("/api/pages", requireAdministrator, ...protectedJsonBodyParser, createPagesRouter(queryExecutor));
  app.use("/api/news", requireAdministrator, ...protectedJsonBodyParser, createNewsRouter(queryExecutor));
  app.use("/api/images", requireAdministrator, ...protectedJsonBodyParser, createImagesRouter(queryExecutor));
  app.use("/api/settings", requireAdministrator, ...protectedJsonBodyParser, createSettingsRouter(queryExecutor));

  app.use(
    "/uploads",
    express.static(config.uploadsDir, {
      dotfiles: "deny",
      fallthrough: true,
      index: false,
      maxAge: config.nodeEnv === "production" ? "30d" : 0,
    }),
  );

  app.use((_request, _response, next) => {
    next(new AppError(404, "NOT_FOUND", "Route not found"));
  });

  app.use(errorHandler);

  return app;
}

function createJsonBodyParser(limit: number): RequestHandler[] {
  return [
    express.json({
      limit,
      strict: true,
      verify: (request, _response, buffer, encoding) => {
        rawJsonBodies.set(request, buffer.toString(encoding as BufferEncoding));
      },
    }),
    (request, _response, next) => {
      const rawJson = rawJsonBodies.get(request);
      if (rawJson !== undefined) {
        rawJsonBodies.delete(request);
        validateJsonNumberTokens(rawJson);
      }
      next();
    },
  ];
}

function requireCanonicalApiPath(): RequestHandler {
  return (request, _response, next) => {
    const rawPath = request.originalUrl.split("?", 1)[0] ?? "";
    let decodedPath: string;
    try {
      decodedPath = decodeURI(rawPath);
    } catch {
      next(new AppError(404, "NOT_FOUND", "Route not found"));
      return;
    }
    if (
      decodedPath !== decodedPath.toLocaleLowerCase() ||
      (decodedPath.length > 4 && decodedPath.endsWith("/")) ||
      decodedPath.includes("//") ||
      decodedPath.includes("\\") ||
      /%(?:2f|5c)/i.test(rawPath)
    ) {
      next(new AppError(404, "NOT_FOUND", "Route not found"));
      return;
    }
    next();
  };
}

function requireTrustedBrowserOrigin(): RequestHandler {
  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

  return (request, _response, next) => {
    if (safeMethods.has(request.method)) {
      next();
      return;
    }

    const origin = request.get("origin");
    const fetchSite = request.get("sec-fetch-site")?.toLowerCase();
    const trustedOrigin = origin !== undefined && config.network.publicOrigins.includes(origin);

    if (
      (origin !== undefined && !trustedOrigin) ||
      (origin === undefined && fetchSite !== undefined && !["same-origin", "none"].includes(fetchSite))
    ) {
      next(new AppError(403, "UNTRUSTED_ORIGIN", "Request origin is not allowed"));
      return;
    }

    next();
  };
}
