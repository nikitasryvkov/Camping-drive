import type { JsonObject } from "./validation.js";

export type PublicImageSource = {
  url: string;
  width: number | null;
  height: number | null;
};

export type PublicImageSources = {
  original: PublicImageSource;
  medium?: PublicImageSource;
  thumbnail?: PublicImageSource;
};

export type PublicImageRow = {
  storagePath: string;
  width: number | null;
  height: number | null;
  variants: JsonObject;
};

export function toPublicImageSources(image: PublicImageRow): PublicImageSources {
  return {
    original: {
      url: `/uploads/${image.storagePath}`,
      width: image.width,
      height: image.height,
    },
    ...variantSource(image.variants.medium, "medium"),
    ...variantSource(image.variants.thumbnail, "thumbnail"),
  };
}

function variantSource(
  value: unknown,
  key: "medium" | "thumbnail",
): Partial<Pick<PublicImageSources, "medium" | "thumbnail">> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const variant = value as JsonObject;
  const storagePath = variant.storagePath;
  if (typeof storagePath !== "string" || !storagePath) return {};
  return {
    [key]: {
      url: `/uploads/${storagePath}`,
      width: typeof variant.width === "number" ? variant.width : null,
      height: typeof variant.height === "number" ? variant.height : null,
    },
  };
}
