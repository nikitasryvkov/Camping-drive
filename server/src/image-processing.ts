import sharp, { type Sharp } from "sharp";

import { AppError, ValidationError } from "./errors.js";

const supportedFormats = new Set(["jpeg", "png", "webp"]);

// Keep libvips memory bounded inside the backend container. Request-level
// concurrency is separately limited before multipart bodies are accepted.
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 20 });

export type ProcessedImageFile = {
  buffer: Buffer;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: "image/webp";
};

export type ProcessedImage = {
  original: ProcessedImageFile;
  medium: ProcessedImageFile;
  thumbnail: ProcessedImageFile;
};

export type ImageProcessingLimits = {
  maxUploadBytes: number;
  maxInputPixels: number;
};

const defaultLimits: ImageProcessingLimits = {
  maxUploadBytes: 15 * 1024 * 1024,
  maxInputPixels: 40_000_000,
};

export async function processUploadedImage(
  input: Buffer,
  limits: ImageProcessingLimits = defaultLimits,
): Promise<ProcessedImage> {
  if (input.length === 0) {
    throw invalidImage("The uploaded file is empty");
  }

  if (input.length > limits.maxUploadBytes) {
    throw new ValidationError("The uploaded image is too large", {
      maxBytes: limits.maxUploadBytes,
    });
  }

  let metadata;
  try {
    metadata = await sharp(input, {
      failOn: "warning",
      limitInputPixels: limits.maxInputPixels,
    }).metadata();
  } catch (error) {
    throw classifySharpError(error, "The file is damaged or is not a supported image");
  }

  if (!metadata.format || !supportedFormats.has(metadata.format)) {
    throw invalidImage("Only JPEG, PNG and WebP images are supported");
  }

  if (!metadata.width || !metadata.height) {
    throw invalidImage("The image dimensions could not be determined");
  }

  if ((metadata.pages ?? 1) > 1) {
    throw invalidImage("Animated images are not supported");
  }

  if (metadata.width * metadata.height > limits.maxInputPixels) {
    throw invalidImage(
      `The image must contain no more than ${limits.maxInputPixels.toLocaleString("en-US")} pixels`,
    );
  }

  try {
    const original = await renderWebp(createPipeline(input, limits.maxInputPixels), 2560, 2560, 82);
    const medium = await renderWebp(createPipeline(input, limits.maxInputPixels), 1280, 1280, 80);
    const thumbnail = await renderWebp(createPipeline(input, limits.maxInputPixels), 480, 480, 76);
    return { original, medium, thumbnail };
  } catch (error) {
    throw classifySharpError(error, "The image could not be processed");
  }
}

function createPipeline(input: Buffer, maxInputPixels: number): Sharp {
  return sharp(input, {
    failOn: "warning",
    limitInputPixels: maxInputPixels,
  }).rotate();
}

async function renderWebp(
  pipeline: Sharp,
  width: number,
  height: number,
  quality: number,
): Promise<ProcessedImageFile> {
  const { data, info } = await pipeline
    .resize({ width, height, fit: "inside", withoutEnlargement: true })
    .webp({ quality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    sizeBytes: data.length,
    mimeType: "image/webp",
  };
}

function invalidImage(message: string): ValidationError {
  return new ValidationError(message, {
    supportedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
}

function classifySharpError(error: unknown, clientMessage: string): AppError {
  const message = error instanceof Error ? error.message : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (
    code === "ENOMEM" ||
    /(?:out of memory|memory allocation|failed to allocate|bad alloc)/i.test(message)
  ) {
    return new AppError(
      503,
      "IMAGE_PROCESSING_UNAVAILABLE",
      "Image processing is temporarily unavailable",
    );
  }
  if (
    /(?:unsupported image|input buffer|corrupt|invalid image|unexpected end|premature end|pngload|jpegload|webpload|pixel limit)/i.test(message)
  ) {
    return invalidImage(clientMessage);
  }
  return new AppError(500, "IMAGE_PROCESSING_FAILED", "The image could not be processed");
}
