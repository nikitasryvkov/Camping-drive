import { ValidationError } from "./errors.js";
import { parseId, type JsonObject } from "./validation.js";
import {
  getPageBudgetViolation,
} from "../../shared/page-limits.js";
import { isSafeImageUrl, isSafeLinkUrl } from "../../shared/safe-url.js";

export {
  MAX_PAGE_BLOCKS,
  MAX_PAGE_COLLECTION_ITEMS,
  MAX_PAGE_CONTENT_BYTES,
} from "../../shared/page-limits.js";

export const PAGE_BLOCK_TYPES = [
  "hero",
  "text",
  "image-text",
  "cards",
  "features",
  "steps",
  "stats",
  "gallery",
  "reviews",
  "faq",
  "route-map",
  "cta",
  "latest-news",
  "marquee",
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];

type Rule =
  | { kind: "string"; maxLength: number; url?: "link" | "image" }
  | { kind: "integer"; min: number; max: number }
  | { kind: "imageId" }
  | { kind: "items"; maxItems: number; fields: Schema };

type Schema = Record<string, Rule>;

const shortText = (): Rule => ({ kind: "string", maxLength: 500 });
const longText = (): Rule => ({ kind: "string", maxLength: 20_000 });
const url = (): Rule => ({ kind: "string", maxLength: 2_000, url: "link" });
const imageUrl = (): Rule => ({ kind: "string", maxLength: 2_000, url: "image" });
const heading = (): Schema => ({ anchor: shortText(), eyebrow: shortText(), title: shortText() });
const image = (key: string): Schema => ({
  [`${key}Id`]: { kind: "imageId" },
  [`${key}Url`]: imageUrl(),
  [`${key}Alt`]: { kind: "string", maxLength: 500 },
});
const items = (fields: Schema, maxItems = 50): Rule => ({ kind: "items", fields, maxItems });

const schemas: Record<PageBlockType, Schema> = {
  hero: {
    ...heading(),
    text: longText(),
    primaryButtonLabel: shortText(),
    primaryButtonUrl: url(),
    secondaryButtonLabel: shortText(),
    secondaryButtonUrl: url(),
    ...image("backgroundImage"),
    ...image("backgroundImageNight"),
  },
  text: {
    ...heading(),
    body: longText(),
    alignment: { kind: "string", maxLength: 20 },
  },
  "image-text": {
    ...heading(),
    body: longText(),
    buttonLabel: shortText(),
    buttonUrl: url(),
    imagePosition: { kind: "string", maxLength: 20 },
    ...image("image"),
  },
  cards: {
    ...heading(),
    intro: longText(),
    items: items({
      title: shortText(),
      text: longText(),
      linkLabel: shortText(),
      linkUrl: url(),
      ...image("image"),
      ...image("imageNight"),
    }),
  },
  features: {
    ...heading(),
    items: items({ icon: shortText(), title: shortText(), text: longText(), ...image("image") }),
  },
  steps: {
    ...heading(),
    items: items({ title: shortText(), text: longText() }),
  },
  stats: {
    ...heading(),
    items: items({ value: shortText(), label: shortText() }),
  },
  gallery: {
    ...heading(),
    items: items({ ...image("image"), caption: shortText() }),
  },
  reviews: {
    ...heading(),
    items: items({
      name: shortText(),
      text: longText(),
      rating: { kind: "integer", min: 1, max: 5 },
    }),
  },
  faq: {
    ...heading(),
    items: items({ question: shortText(), answer: longText() }),
  },
  "route-map": {
    ...heading(),
    address: shortText(),
    body: longText(),
    mapUrl: url(),
    buttonLabel: shortText(),
    buttonUrl: url(),
    ...image("image"),
  },
  cta: {
    ...heading(),
    text: longText(),
    buttonLabel: shortText(),
    buttonUrl: url(),
    ...image("backgroundImage"),
    ...image("backgroundImageNight"),
  },
  "latest-news": {
    ...heading(),
    count: { kind: "integer", min: 1, max: 12 },
    buttonLabel: shortText(),
    buttonUrl: url(),
  },
  marquee: {
    anchor: shortText(),
    items: items({ text: shortText() }, 20),
  },
};

export function validatePageBlockContent(type: PageBlockType, content: JsonObject): void {
  validateObject(content, schemas[type], "content");

  if (content.anchor !== undefined && content.anchor !== "" && !/^[a-z][a-z0-9-]{0,99}$/.test(String(content.anchor))) {
    invalid("content.anchor", "Must start with a Latin letter and contain only lowercase letters, numbers, or hyphens");
  }

  if (type === "text" && content.alignment !== undefined && !["left", "center"].includes(String(content.alignment))) {
    invalid("content.alignment", "Must be left or center");
  }
  if (
    type === "image-text" &&
    content.imagePosition !== undefined &&
    !["left", "right"].includes(String(content.imagePosition))
  ) {
    invalid("content.imagePosition", "Must be left or right");
  }
}

export function validatePageContentBudget(
  blocks: ReadonlyArray<{ content: JsonObject }>,
  field = "blocks",
): void {
  const violation = getPageBudgetViolation(blocks);
  if (!violation) return;
  if (violation.kind === "blocks") {
    invalid(field, `A page must contain no more than ${violation.limit} blocks`);
  }
  if (violation.kind === "contentBytes") {
    invalid(field, `Combined block content must not exceed ${violation.limit} bytes`);
  }
  invalid(field, `A page must contain no more than ${violation.limit} collection items`);
}

function validateObject(value: JsonObject, schema: Schema, path: string): void {
  const unknownFields = Object.keys(value).filter((key) => !Object.hasOwn(schema, key));
  if (unknownFields.length > 0) {
    invalid(`${path}.${unknownFields[0]}`, "Unknown field for this block type");
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    const rule = schema[key]!;
    const fieldPath = `${path}.${key}`;

    if (rule.kind === "string") {
      if (typeof fieldValue !== "string" || fieldValue.length > rule.maxLength) {
        invalid(fieldPath, `Must be a string no longer than ${rule.maxLength} characters`);
      }
      if (rule.url === "link" && fieldValue && !isSafeLinkUrl(fieldValue)) {
        invalid(fieldPath, "Must be an http(s), mailto, tel, root-relative or anchor URL");
      }
      if (rule.url === "image" && fieldValue && !isSafeImageUrl(fieldValue)) {
        invalid(fieldPath, "Must be an http(s) or root-relative image URL");
      }
      continue;
    }

    if (rule.kind === "integer") {
      if (
        typeof fieldValue !== "number" ||
        !Number.isSafeInteger(fieldValue) ||
        fieldValue < rule.min ||
        fieldValue > rule.max
      ) {
        invalid(fieldPath, `Must be an integer between ${rule.min} and ${rule.max}`);
      }
      continue;
    }

    if (rule.kind === "imageId") {
      if (fieldValue === null) continue;
      if (typeof fieldValue !== "string" && typeof fieldValue !== "number") {
        invalid(fieldPath, "Must be a positive image ID or null");
      }
      try {
        parseId(String(fieldValue), fieldPath);
      } catch {
        invalid(fieldPath, "Must be a positive image ID or null");
      }
      continue;
    }

    if (!Array.isArray(fieldValue) || fieldValue.length > rule.maxItems) {
      invalid(fieldPath, `Must be an array with no more than ${rule.maxItems} items`);
    }
    fieldValue.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        invalid(`${fieldPath}[${index}]`, "Must be an object");
      }
      validateObject(item as JsonObject, rule.fields, `${fieldPath}[${index}]`);
    });
  }
}

function invalid(field: string, message: string): never {
  throw new ValidationError("The request contains invalid page block data", {
    fields: [{ field, message }],
  });
}
