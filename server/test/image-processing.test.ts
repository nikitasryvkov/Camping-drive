import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { ValidationError } from "../src/errors.js";
import { processUploadedImage } from "../src/image-processing.js";

describe("image processing", () => {
  it("normalizes images to bounded WebP variants", async () => {
    const input = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 4,
        background: { r: 38, g: 124, b: 75, alpha: 0.7 },
      },
    }).png().toBuffer();

    const result = await processUploadedImage(input);
    assert.deepEqual(
      {
        original: [result.original.width, result.original.height],
        medium: [result.medium.width, result.medium.height],
        thumbnail: [result.thumbnail.width, result.thumbnail.height],
      },
      {
        original: [2000, 1000],
        medium: [1280, 640],
        thumbnail: [480, 240],
      },
    );

    for (const variant of Object.values(result)) {
      const metadata = await sharp(variant.buffer).metadata();
      assert.equal(variant.mimeType, "image/webp");
      assert.equal(metadata.format, "webp");
      assert.equal(variant.sizeBytes, variant.buffer.length);
    }
  });

  it("rejects empty, damaged and unsupported files", async () => {
    await assert.rejects(() => processUploadedImage(Buffer.alloc(0)), ValidationError);
    await assert.rejects(() => processUploadedImage(Buffer.from("not an image")), ValidationError);
    await assert.rejects(
      () => processUploadedImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      ValidationError,
    );
  });
});
