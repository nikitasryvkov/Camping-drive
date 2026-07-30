import type { ErrorRequestHandler } from "express";

type ErrorDetails = Record<string, unknown> | Array<Record<string, unknown>>;
const expectedOverloadCodes = new Set([
  "IMAGE_PROCESSING_BUSY",
  "PASSWORD_VERIFICATION_BUSY",
]);
const overloadLogIntervalMs = 60_000;
const lastOverloadLogAt = new Map<string, number>();

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;

  constructor(status: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(400, "VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, "NOT_FOUND", `${resource} not found`);
    this.name = "NotFoundError";
  }
}

function isPostgresError(error: unknown): error is { code: string; constraint?: string; detail?: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string",
  );
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (isPostgresError(error)) {
    if (error.code === "23505") {
      return new AppError(409, "CONFLICT", "A record with these values already exists");
    }

    if (error.code === "23503") {
      return new AppError(409, "REFERENCE_CONFLICT", "A referenced record does not exist or is still in use");
    }

    if (error.code === "23514" || error.code.startsWith("22")) {
      return new ValidationError("The request contains a value rejected by the database");
    }
  }

  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return new AppError(413, "IMAGE_TOO_LARGE", "The uploaded image is too large");
    }

    if (typeof error.code === "string" && error.code.startsWith("LIMIT_")) {
      return new ValidationError("The multipart upload contains invalid fields or too many files");
    }
  }

  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    return new ValidationError("Request body must contain valid JSON");
  }

  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  const clientStatus = getClientErrorStatus(error);
  if (clientStatus !== undefined) {
    const code = clientStatus === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "BAD_REQUEST";
    const message = clientStatus === 415 ? "Unsupported request media type" : "Invalid request";
    return new AppError(clientStatus, code, message);
  }

  return new AppError(500, "INTERNAL_ERROR", "Internal server error");
}

function getClientErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const status = "status" in error ? error.status : undefined;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const candidate = typeof status === "number" ? status : statusCode;

  return typeof candidate === "number" && candidate >= 400 && candidate < 500
    ? candidate
    : undefined;
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);

  if (expectedOverloadCodes.has(normalized.code)) {
    const now = Date.now();
    const lastLoggedAt = lastOverloadLogAt.get(normalized.code) ?? 0;
    if (now - lastLoggedAt >= overloadLogIntervalMs) {
      lastOverloadLogAt.set(normalized.code, now);
      console.warn("Request load shed", {
        code: normalized.code,
        retryAfter: response.getHeader("Retry-After"),
      });
    }
  } else if (normalized.status >= 500) {
    console.error("Unhandled request error", error);
  }

  response.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  });
};
