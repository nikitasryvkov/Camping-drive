import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  Router,
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import type { QueryResultRow } from "pg";

import { CapacityLimiter } from "../capacity-limiter.js";
import { config } from "../config.js";
import type { QueryExecutor } from "../database.js";
import { AppError, ValidationError } from "../errors.js";
import { processUploadedImage, type ProcessedImageFile } from "../image-processing.js";
import { sweepOrphanedImageFiles } from "../orphaned-uploads.js";
import {
  ensureAtLeastOneField,
  parseBody,
  parseId,
  parseOptionalQueryString,
  parsePagination,
  readDateTime,
  readString,
  rejectUnknownFields,
  type JsonObject,
} from "../validation.js";
import { fetchList, fetchOne } from "./shared.js";

const mimeTypePattern = /^image\/[a-z0-9.+-]+$/;
const generatedImagePathPattern = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\/original\.webp$/;

type ImageVariant = {
  storagePath: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
};

interface ImageRow extends QueryResultRow {
  id: string;
  filename: string;
  originalFilename: string;
  storagePath: string;
  url: string;
  mimeType: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  variants: Record<string, ImageVariant>;
  usageCount: number;
  pageBlockUsageCount: number;
  newsUsageCount: number;
  siteSettingUsageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface DeletionQueueRow extends QueryResultRow {
  id: string;
  imageId: string;
  storagePath: string;
  variants: Record<string, ImageVariant>;
  attempts: number;
}

const imageColumns = `
  images.id::text AS "id",
  images.filename,
  images.original_filename AS "originalFilename",
  images.storage_path AS "storagePath",
  '/uploads/' || images.storage_path AS "url",
  images.mime_type AS "mimeType",
  images.size_bytes::text AS "sizeBytes",
  images.width,
  images.height,
  images.alt_text AS "altText",
  images.variants,
  (usage.page_block_count + usage.news_count + usage.site_setting_count)::integer AS "usageCount",
  usage.page_block_count::integer AS "pageBlockUsageCount",
  usage.news_count::integer AS "newsUsageCount",
  usage.site_setting_count::integer AS "siteSettingUsageCount",
  images.created_at AS "createdAt",
  images.updated_at AS "updatedAt"
`;

const imageUsageJoin = `
  LEFT JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM page_block_images WHERE image_id = images.id) AS page_block_count,
      (SELECT count(*) FROM news WHERE cover_image_id = images.id) AS news_count,
      (SELECT count(*) FROM site_setting_images WHERE image_id = images.id) AS site_setting_count
  ) AS usage ON true
`;

const insertedImageColumns = `
  id::text AS "id",
  filename,
  original_filename AS "originalFilename",
  storage_path AS "storagePath",
  '/uploads/' || storage_path AS "url",
  mime_type AS "mimeType",
  size_bytes::text AS "sizeBytes",
  width,
  height,
  alt_text AS "altText",
  variants,
  0::integer AS "usageCount",
  0::integer AS "pageBlockUsageCount",
  0::integer AS "newsUsageCount",
  0::integer AS "siteSettingUsageCount",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const uploadConstraints = Object.freeze({
  maxFileBytes: config.images.maxUploadBytes,
  maxInputPixels: config.images.maxInputPixels,
  supportedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.images.maxUploadBytes,
    files: 1,
    fields: 2,
    parts: 4,
    fieldSize: 2_000,
  },
});
const imageProcessingCapacity = new CapacityLimiter(config.images.processingConcurrency);
const releaseAfterUploadError: ErrorRequestHandler = (error, _request, response, next) => {
  releaseImageProcessingCapacity(response);
  next(error);
};

export function createImagesRouter(database: QueryExecutor): Router {
  const router = Router();

  router.get("/", async (request, response) => {
    const query = request.query as JsonObject;
    const { limit, offset } = parsePagination(query);
    const mimeType = parseOptionalQueryString(query.mimeType, "mimeType", 100);
    const search = parseOptionalQueryString(query.search, "search", 200);
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (mimeType) {
      if (!mimeTypePattern.test(mimeType)) {
        throw new ValidationError("The request contains invalid data", {
          fields: [{ field: "mimeType", message: "Must be an image MIME type" }],
        });
      }
      values.push(mimeType);
      conditions.push(`images.mime_type = $${values.length}`);
    }

    if (search) {
      values.push(`%${escapeLike(search)}%`);
      conditions.push(`(images.filename ILIKE $${values.length} ESCAPE '\\' OR images.original_filename ILIKE $${values.length} ESCAPE '\\' OR COALESCE(images.alt_text, '') ILIKE $${values.length} ESCAPE '\\')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await fetchList<ImageRow>(
      database,
      `SELECT ${imageColumns} FROM images ${imageUsageJoin} ${where} ORDER BY images.created_at DESC, images.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      `SELECT count(*)::text AS total FROM images ${where}`,
      values,
      limit,
      offset,
    );
    response.json({ ...result, uploadConstraints });
  });

  router.get("/batch", async (request, response) => {
    const query = request.query as JsonObject;
    const rawIds = parseOptionalQueryString(query.ids, "ids", 4_000);
    const tokens = rawIds?.split(",") ?? [];
    if (tokens.length === 0 || tokens.length > 200) {
      throw new ValidationError("The request contains invalid data", {
        fields: [{ field: "ids", message: "Must contain between 1 and 200 image IDs" }],
      });
    }
    const ids = [...new Set(tokens.map((token, index) => parseId(token, `ids[${index}]`)))];
    const result = await database.query<ImageRow>(
      `SELECT ${imageColumns}
       FROM images
       ${imageUsageJoin}
       WHERE images.id = ANY($1::bigint[])
       ORDER BY images.id`,
      [ids],
    );
    response.json({ data: result.rows });
  });

  router.get("/:id", async (request, response) => {
    const image = await getImage(database, parseId(request.params.id ?? ""));
    response.json({ data: image });
  });

  router.post("/", (_request: Request, response: Response, next: NextFunction) => {
    const release = imageProcessingCapacity.tryAcquire();
    if (!release) {
      response.setHeader("Retry-After", "5");
      next(new AppError(
        503,
        "IMAGE_PROCESSING_BUSY",
        "Image processing is busy; retry the upload shortly",
      ));
      return;
    }

    response.locals.releaseImageProcessingCapacity = release;
    next();
  }, upload.single("image"), releaseAfterUploadError, async (request: Request, response: Response) => {
    try {
      if (!request.file) {
        throw new ValidationError("Multipart field 'image' must contain an image file");
      }

      const body = parseBody(request.body);
      rejectUnknownFields(body, ["altText"]);
      const altText = readString(body, "altText", {
        nullable: true,
        allowEmpty: true,
        maxLength: 500,
      });
      const processed = await processUploadedImage(request.file.buffer, config.images);
      const storage = createStoragePaths();
      const variants = {
        medium: toVariant(storage.medium, processed.medium),
        thumbnail: toVariant(storage.thumbnail, processed.thumbnail),
      };

      await mkdir(resolveUploadPath(storage.directory), { recursive: true });

      let createdImage: ImageRow;
      try {
        await Promise.all([
          writeFile(resolveUploadPath(storage.original), processed.original.buffer, { flag: "wx" }),
          writeFile(resolveUploadPath(storage.medium), processed.medium.buffer, { flag: "wx" }),
          writeFile(resolveUploadPath(storage.thumbnail), processed.thumbnail.buffer, { flag: "wx" }),
        ]);

        const originalFilename = normalizeOriginalFilename(request.file.originalname);
        const result = await database.query<ImageRow>(
          `INSERT INTO images (
             filename, original_filename, storage_path, mime_type, size_bytes,
             width, height, alt_text, variants
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING ${insertedImageColumns}`,
          [
            `${storage.identifier}.webp`,
            originalFilename,
            storage.original,
            processed.original.mimeType,
            processed.original.sizeBytes,
            processed.original.width,
            processed.original.height,
            altText || null,
            variants,
          ],
        );
        createdImage = result.rows[0]!;
      } catch (error) {
        await rm(resolveUploadPath(storage.directory), { recursive: true, force: true }).catch(
          (cleanupError) => console.error("Failed to clean up an unsuccessful image upload", cleanupError),
        );
        throw error;
      }
      response.status(201).json({ data: createdImage });
    } finally {
      releaseImageProcessingCapacity(response);
    }
  });

  router.patch("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const body = parseBody(request.body);
    rejectUnknownFields(body, ["altText", "expectedUpdatedAt"]);
    ensureAtLeastOneField(body);
    if (!Object.hasOwn(body, "altText")) {
      throw new ValidationError("The request contains invalid data", {
        fields: [{ field: "altText", message: "Field is required" }],
      });
    }
    const altText = readString(body, "altText", {
      nullable: true,
      allowEmpty: true,
      maxLength: 500,
    });
    const expectedUpdatedAt = readDateTime(body, "expectedUpdatedAt", { required: true })!;
    const result = await database.query(
      `UPDATE images
       SET alt_text = $1
       WHERE id = $2 AND updated_at = $3::timestamptz
       RETURNING id`,
      [altText || null, id, expectedUpdatedAt],
    );
    if (result.rowCount === 0) {
      const exists = await database.query("SELECT 1 FROM images WHERE id = $1", [id]);
      if (exists.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Image not found");
      throw new AppError(409, "EDIT_CONFLICT", "Image was changed in another browser session");
    }
    response.json({ data: await getImage(database, id) });
  });

  router.delete("/:id", async (request, response) => {
    const id = parseId(request.params.id ?? "");
    const expectedUpdatedAt = readDateTime(
      { expectedUpdatedAt: request.query.expectedUpdatedAt },
      "expectedUpdatedAt",
      { required: true },
    )!;
    if (!database.connect) {
      throw new Error("Image deletion requires a transactional database connection");
    }

    const client = await database.connect();
    const executor = client as unknown as QueryExecutor;
    let queueId: string | undefined;
    try {
      await client.query("BEGIN");
      const lock = await executor.query<{ isCurrent: boolean }>(
        `SELECT (updated_at = $2::timestamptz) AS "isCurrent"
         FROM images
         WHERE id = $1
         FOR UPDATE`,
        [id, expectedUpdatedAt],
      );
      const lockedImage = lock.rows[0];
      if (!lockedImage) throw new AppError(404, "NOT_FOUND", "Image not found");
      if (!lockedImage.isCurrent) {
        throw new AppError(409, "EDIT_CONFLICT", "Image was changed in another browser session");
      }
      const image = await getImage(executor, id);
      if (image.usageCount > 0) {
        throw new AppError(409, "IMAGE_IN_USE", "The image is still in use", {
          pageBlocks: image.pageBlockUsageCount,
          news: image.newsUsageCount,
          siteSettings: image.siteSettingUsageCount,
        });
      }

      const queued = await client.query<{ id: string }>(
        `INSERT INTO image_deletion_queue (image_id, storage_path, variants)
         VALUES ($1, $2, $3)
         RETURNING id::text AS id`,
        [id, image.storagePath, image.variants],
      );
      queueId = queued.rows[0]!.id;
      await client.query("DELETE FROM images WHERE id = $1", [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("Failed to roll back image deletion", rollbackError);
      });
      throw error;
    } finally {
      client.release();
    }

    try {
      await processDeletionQueueEntry(database, queueId!);
      response.status(204).send();
    } catch (error) {
      if (error instanceof AppError && error.code === "IMAGE_DELETE_PENDING") {
        response.status(202).json({ data: { status: "cleanup-pending" } });
        return;
      }
      throw error;
    }
  });

  return router;
}

async function getImage(
  database: QueryExecutor,
  id: string,
  lockForDeletion = false,
): Promise<ImageRow> {
  return fetchOne<ImageRow>(
    database,
    `SELECT ${imageColumns} FROM images ${imageUsageJoin} WHERE images.id = $1${lockForDeletion ? " FOR UPDATE OF images" : ""}`,
    [id],
    "Image",
  );
}

function createStoragePaths() {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const identifier = randomUUID();
  const directory = `${year}/${month}/${identifier}`;
  return {
    identifier,
    directory,
    original: `${directory}/original.webp`,
    medium: `${directory}/medium.webp`,
    thumbnail: `${directory}/thumbnail.webp`,
  };
}

function toVariant(storagePath: string, file: ProcessedImageFile): ImageVariant {
  return {
    storagePath,
    url: `/uploads/${storagePath}`,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
  };
}

function resolveUploadPath(relativePath: string): string {
  const root = path.resolve(config.uploadsDir);
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Resolved image path escapes the uploads directory");
  }
  return absolutePath;
}

function normalizeOriginalFilename(value: string): string {
  const basename = path.basename(decodeMultipartFilename(value).replaceAll("\\", "/"));
  const cleaned = basename.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return Array.from(cleaned || "image").slice(0, 255).join("");
}

function decodeMultipartFilename(value: string): string {
  if ([...value].some((character) => character.charCodeAt(0) > 255)) {
    return value;
  }

  const rawBytes = Buffer.from(value, "latin1");
  const decoded = rawBytes.toString("utf8");
  return decoded.includes("\uFFFD") || !Buffer.from(decoded, "utf8").equals(rawBytes)
    ? value
    : decoded;
}

async function deleteStoredImageFiles(image: {
  storagePath: string;
  variants: Record<string, ImageVariant>;
}): Promise<void> {
  if (generatedImagePathPattern.test(image.storagePath)) {
    await rm(resolveUploadPath(path.posix.dirname(image.storagePath)), {
      recursive: true,
      force: true,
    });
    return;
  }

  const storedPaths = new Set([image.storagePath]);
  for (const variant of Object.values(image.variants ?? {})) {
    if (variant && typeof variant.storagePath === "string") {
      storedPaths.add(variant.storagePath);
    }
  }
  await Promise.all(
    [...storedPaths].map((storedPath) =>
      unlink(resolveUploadPath(storedPath)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }),
    ),
  );
}

async function processDeletionQueueEntry(
  database: QueryExecutor,
  queueId: string,
  claimedEntry?: DeletionQueueRow,
): Promise<void> {
  let queued = claimedEntry;
  if (!queued) {
    const result = await database.query<DeletionQueueRow>(
      `SELECT
         id::text AS "id",
         image_id::text AS "imageId",
         storage_path AS "storagePath",
         variants,
         attempts
       FROM image_deletion_queue
       WHERE id = $1`,
      [queueId],
    );
    queued = result.rows[0];
    if (!queued) return;
  }

  try {
    await deleteStoredImageFiles(queued);
    await database.query("DELETE FROM image_deletion_queue WHERE id = $1", [queueId]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : "Unknown file deletion error";
    await database.query(
      `UPDATE image_deletion_queue
       SET attempts = attempts + 1,
           last_error = $1,
           next_attempt_at = now() + LEAST(
             interval '24 hours',
             interval '30 seconds' * power(2, LEAST(attempts, 10))
           )
       WHERE id = $2`,
      [message, queueId],
    ).catch((updateError) => {
      console.error(`Failed to record cleanup error for deleted image ${queued.imageId}`, updateError);
    });
    throw new AppError(
      503,
      "IMAGE_DELETE_PENDING",
      "The image record was deleted, but file cleanup is pending",
    );
  }
}

export async function retryPendingImageDeletions(database: QueryExecutor): Promise<void> {
  while (true) {
    const result = await database.query<DeletionQueueRow>(
      `WITH due AS (
         SELECT id
         FROM image_deletion_queue
         WHERE next_attempt_at <= now()
         ORDER BY next_attempt_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 100
       )
       UPDATE image_deletion_queue AS queue
       SET next_attempt_at = now() + interval '5 minutes'
       FROM due
       WHERE queue.id = due.id
       RETURNING
         queue.id::text AS "id",
         queue.image_id::text AS "imageId",
         queue.storage_path AS "storagePath",
         queue.variants,
         queue.attempts`,
    );

    if (result.rows.length === 0) return;
    for (const row of result.rows) {
      try {
        await processDeletionQueueEntry(database, row.id, row);
      } catch (error) {
        console.error(`Pending image cleanup ${row.id} will be retried with backoff`, error);
      }
    }
  }
}

export function startImageDeletionWorker(database: QueryExecutor): () => void {
  let stopped = false;
  let running = false;
  let lastOrphanSweepAt = 0;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await retryPendingImageDeletions(database);
      if (Date.now() - lastOrphanSweepAt >= 60 * 60 * 1_000) {
        const removed = await sweepOrphanedImageFiles(database, { uploadsDir: config.uploadsDir });
        lastOrphanSweepAt = Date.now();
        if (removed > 0) console.warn(`Removed ${removed} orphaned image file(s)`);
      }
    } catch (error) {
      console.error("Image deletion worker failed", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), 30_000);
  timer.unref();
  void run();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function releaseImageProcessingCapacity(response: Response): void {
  const release = response.locals.releaseImageProcessingCapacity as (() => void) | undefined;
  if (!release) return;
  delete response.locals.releaseImageProcessingCapacity;
  release();
}
