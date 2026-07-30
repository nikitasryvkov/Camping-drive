import { ValidationError } from "./errors.js";

export type JsonObject = Record<string, unknown>;

const postgresBigintMax = 9_223_372_036_854_775_807n;
const rfc3339Pattern = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|([+-])([01]\d|2[0-3]):([0-5]\d))$/;
const jsonNumberTokenPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

type StringOptions = {
  required?: boolean;
  nullable?: boolean;
  allowEmpty?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  normalize?: (value: string) => string;
};

type NumberOptions = {
  required?: boolean;
  nullable?: boolean;
  min?: number;
  max?: number;
};

export function parseBody(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Request body must be a JSON object");
  }

  return value as JsonObject;
}

export function validateJsonNumberTokens(rawJson: string): void {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < rawJson.length; index += 1) {
    const character = rawJson[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character !== "-" && (character < "0" || character > "9")) {
      continue;
    }

    jsonNumberTokenPattern.lastIndex = index;
    const match = jsonNumberTokenPattern.exec(rawJson);
    if (!match) {
      continue;
    }

    assertLosslessJsonNumber(match[0]);
    index = jsonNumberTokenPattern.lastIndex - 1;
  }
}

export function rejectUnknownFields(body: JsonObject, allowedFields: readonly string[]): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(body).filter((field) => !allowed.has(field));

  if (unknown.length > 0) {
    throw new ValidationError("Request body contains unknown fields", {
      fields: unknown.map((field) => ({ field, message: "Unknown field" })),
    });
  }
}

export function hasField(body: JsonObject, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}

export function readString(
  body: JsonObject,
  field: string,
  options: StringOptions = {},
): string | null | undefined {
  if (!hasField(body, field)) {
    if (options.required) {
      throw fieldError(field, "Field is required");
    }

    return undefined;
  }

  const rawValue = body[field];

  if (rawValue === null && options.nullable) {
    return null;
  }

  if (typeof rawValue !== "string") {
    throw fieldError(field, options.nullable ? "Must be a string or null" : "Must be a string");
  }

  const value = options.normalize ? options.normalize(rawValue) : rawValue.trim();

  if (!options.allowEmpty && value.length === 0) {
    throw fieldError(field, "Must not be empty");
  }

  if (options.minLength !== undefined && value.length < options.minLength) {
    throw fieldError(field, `Must contain at least ${options.minLength} characters`);
  }

  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw fieldError(field, `Must contain no more than ${options.maxLength} characters`);
  }

  if (options.pattern && !options.pattern.test(value)) {
    throw fieldError(field, "Has an invalid format");
  }

  return value;
}

export function readBoolean(
  body: JsonObject,
  field: string,
  options: { required?: boolean } = {},
): boolean | undefined {
  if (!hasField(body, field)) {
    if (options.required) {
      throw fieldError(field, "Field is required");
    }

    return undefined;
  }

  if (typeof body[field] !== "boolean") {
    throw fieldError(field, "Must be a boolean");
  }

  return body[field];
}

export function readInteger(
  body: JsonObject,
  field: string,
  options: NumberOptions = {},
): number | null | undefined {
  if (!hasField(body, field)) {
    if (options.required) {
      throw fieldError(field, "Field is required");
    }

    return undefined;
  }

  const value = body[field];

  if (value === null && options.nullable) {
    return null;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw fieldError(field, options.nullable ? "Must be an integer or null" : "Must be an integer");
  }

  if (options.min !== undefined && value < options.min) {
    throw fieldError(field, `Must be greater than or equal to ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    throw fieldError(field, `Must be less than or equal to ${options.max}`);
  }

  return value;
}

export function readEnum<T extends string>(
  body: JsonObject,
  field: string,
  values: readonly T[],
  options: { required?: boolean } = {},
): T | undefined {
  const value = readString(body, field, { required: options.required });

  if (value === undefined) {
    return undefined;
  }

  if (!values.includes(value as T)) {
    throw fieldError(field, `Must be one of: ${values.join(", ")}`);
  }

  return value as T;
}

export function readDateTime(
  body: JsonObject,
  field: string,
  options: { required?: boolean; nullable?: boolean } = {},
): string | null | undefined {
  const value = readString(body, field, {
    required: options.required,
    nullable: options.nullable,
  });

  if (value === undefined || value === null) {
    return value;
  }

  const match = rfc3339Pattern.exec(value);
  if (!match || match[1] === "0000") {
    throw fieldError(field, "Must be an RFC 3339 date and time with a time zone");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = getDaysInMonth(year, month);

  if (daysInMonth === undefined || day < 1 || day > daysInMonth) {
    throw fieldError(field, "Must be a real RFC 3339 date and time");
  }

  const localTime = new Date(0);
  localTime.setUTCFullYear(year, month - 1, day);
  localTime.setUTCHours(Number(match[4]), Number(match[5]), Number(match[6]), 0);
  const offsetMinutes =
    match[8] === "Z" ? 0 : Number(match[10]) * 60 + Number(match[11]);
  const offsetDirection = match[9] === "+" ? -1 : 1;
  const timestamp = localTime.getTime() + offsetDirection * offsetMinutes * 60_000;
  const utcDate = new Date(timestamp);

  if (utcDate.getUTCFullYear() < 1 || utcDate.getUTCFullYear() > 9999) {
    throw fieldError(field, "Date and time must resolve to a year between 0001 and 9999 UTC");
  }

  const normalizedDateTime = utcDate.toISOString().slice(0, 19);
  const fraction = match[7] ? `.${match[7]}` : "";
  return `${normalizedDateTime}${fraction}Z`;
}

export function readObject(
  body: JsonObject,
  field: string,
  options: { required?: boolean } = {},
): JsonObject | undefined {
  if (!hasField(body, field)) {
    if (options.required) {
      throw fieldError(field, "Field is required");
    }

    return undefined;
  }

  const value = body[field];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fieldError(field, "Must be a JSON object");
  }

  validateJsonValue(value, field);

  return value as JsonObject;
}

export function readJson(body: JsonObject, field: string): unknown {
  if (!hasField(body, field)) {
    throw fieldError(field, "Field is required");
  }

  const value = body[field];

  if (value === undefined) {
    throw fieldError(field, "Must be a valid JSON value");
  }

  validateJsonValue(value, field);

  return value;
}

export function parseId(value: string, field = "id"): string {
  if (!/^[1-9]\d*$/.test(value) || value.length > 19 || BigInt(value) > postgresBigintMax) {
    throw fieldError(field, "Must be a positive integer");
  }

  return value;
}

function getDaysInMonth(year: number, month: number): number | undefined {
  if (month < 1 || month > 12) {
    return undefined;
  }

  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validateJsonValue(value: unknown, field: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    visited += 1;

    if (visited > 100_000 || current.depth > 100) {
      throw fieldError(field, "JSON value is too complex");
    }

    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value) || (Number.isInteger(current.value) && !Number.isSafeInteger(current.value))) {
        throw fieldError(field, "JSON numbers must be finite and safely representable");
      }
      continue;
    }

    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }

    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }

    if (current.value && typeof current.value === "object") {
      for (const item of Object.values(current.value)) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }

    throw fieldError(field, "Must contain only valid JSON values");
  }
}

function assertLosslessJsonNumber(rawNumber: string): void {
  const parsed = Number(rawNumber);

  if (!Number.isFinite(parsed)) {
    throw fieldError("body", "JSON number is outside the supported range");
  }

  const serialized = JSON.stringify(parsed);
  if (normalizeDecimal(rawNumber) !== normalizeDecimal(serialized)) {
    throw fieldError("body", "JSON number cannot be represented without changing its value");
  }
}

function normalizeDecimal(value: string): string {
  let normalized = value.toLowerCase();
  let sign = "";

  if (normalized.startsWith("-")) {
    sign = "-";
    normalized = normalized.slice(1);
  }

  const [mantissa, exponentValue = "0"] = normalized.split("e");
  const [integerPart, fractionPart = ""] = mantissa!.split(".");
  let digits = `${integerPart}${fractionPart}`.replace(/^0+/, "");

  if (digits.length === 0) {
    return "0";
  }

  let exponent = Number(exponentValue) - fractionPart.length;
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent += 1;
  }

  return `${sign}${digits}e${exponent}`;
}

export function readId(
  body: JsonObject,
  field: string,
  options: { required?: boolean; nullable?: boolean } = {},
): string | null | undefined {
  if (!hasField(body, field)) {
    if (options.required) {
      throw fieldError(field, "Field is required");
    }

    return undefined;
  }

  const value = body[field];

  if (value === null && options.nullable) {
    return null;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string") {
    return parseId(value, field);
  }

  throw fieldError(field, options.nullable ? "Must be a positive integer or null" : "Must be a positive integer");
}

export function parsePagination(query: JsonObject): { limit: number; offset: number } {
  return {
    limit: parseQueryInteger(query.limit, "limit", 20, 1, 100),
    offset: parseQueryInteger(query.offset, "offset", 0, 0, 1_000_000),
  };
}

export function parseOptionalQueryString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw fieldError(field, "Must appear once and be a string");
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maxLength) {
    throw fieldError(field, `Must contain between 1 and ${maxLength} characters`);
  }

  return normalized;
}

export function ensureAtLeastOneField(body: JsonObject): void {
  if (Object.keys(body).length === 0) {
    throw new ValidationError("Request body must contain at least one field");
  }
}

function parseQueryInteger(
  value: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw fieldError(field, "Must appear once and be an integer");
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw fieldError(field, `Must be between ${min} and ${max}`);
  }

  return parsed;
}

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError("The request contains invalid data", {
    fields: [{ field, message }],
  });
}
