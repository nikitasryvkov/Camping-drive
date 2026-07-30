import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ValidationError } from "../src/errors.js";
import {
  parseBody,
  parseId,
  parsePagination,
  readDateTime,
  readId,
  readInteger,
  readJson,
  readString,
  rejectUnknownFields,
  validateJsonNumberTokens,
} from "../src/validation.js";

describe("request validation", () => {
  it("accepts objects and rejects arrays", () => {
    assert.deepEqual(parseBody({ title: "Page" }), { title: "Page" });
    assert.throws(() => parseBody([]), ValidationError);
    assert.throws(() => parseBody(null), ValidationError);
  });

  it("normalizes and constrains strings", () => {
    const body = { title: "  Camping Drive  ", empty: "" };
    assert.equal(readString(body, "title", { required: true, maxLength: 30 }), "Camping Drive");
    assert.equal(readString(body, "empty", { allowEmpty: true }), "");
    assert.throws(() => readString(body, "empty"), ValidationError);
  });

  it("rejects unknown fields", () => {
    assert.doesNotThrow(() => rejectUnknownFields({ title: "Page" }, ["title"]));
    assert.throws(
      () => rejectUnknownFields({ title: "Page", typo: true }, ["title"]),
      ValidationError,
    );
  });

  it("validates route and body identifiers without losing bigint precision", () => {
    assert.equal(parseId("9223372036854775807"), "9223372036854775807");
    assert.equal(readId({ imageId: 42 }, "imageId"), "42");
    assert.equal(readId({ imageId: "9223372036854775807" }, "imageId"), "9223372036854775807");
    assert.throws(() => parseId("0"), ValidationError);
    assert.throws(() => parseId("9223372036854775808"), ValidationError);
    assert.throws(() => readId({ imageId: 1.2 }, "imageId"), ValidationError);
  });

  it("validates integer limits", () => {
    assert.equal(readInteger({ position: 0 }, "position", { min: 0 }), 0);
    assert.throws(() => readInteger({ position: -1 }, "position", { min: 0 }), ValidationError);
  });

  it("normalizes valid date-times and rejects invalid values", () => {
    assert.equal(
      readDateTime({ publishedAt: "2026-07-21T12:00:00+03:00" }, "publishedAt"),
      "2026-07-21T09:00:00Z",
    );
    assert.equal(
      readDateTime({ publishedAt: "2026-07-21T12:00:00.123456+03:00" }, "publishedAt"),
      "2026-07-21T09:00:00.123456Z",
    );
    assert.throws(
      () => readDateTime({ publishedAt: "not-a-date" }, "publishedAt"),
      ValidationError,
    );
    assert.throws(
      () => readDateTime({ publishedAt: "2026-02-30T12:00:00Z" }, "publishedAt"),
      ValidationError,
    );
    assert.throws(
      () => readDateTime({ publishedAt: "2026-07-21T12:00:00" }, "publishedAt"),
      ValidationError,
    );
  });

  it("rejects JSON numbers that JavaScript cannot represent safely", () => {
    assert.equal(readJson({ value: 42 }, "value"), 42);
    assert.throws(
      () => readJson({ value: 9_007_199_254_740_992 }, "value"),
      ValidationError,
    );
    assert.throws(() => readJson({ value: Number.POSITIVE_INFINITY }, "value"), ValidationError);
  });

  it("rejects numeric JSON tokens that would change during parsing", () => {
    assert.doesNotThrow(() => validateJsonNumberTokens('{"value":0.1,"scaled":1e3}'));
    assert.doesNotThrow(() => validateJsonNumberTokens('{"text":"1.0000000000000001"}'));
    assert.throws(
      () => validateJsonNumberTokens('{"value":1.0000000000000001}'),
      ValidationError,
    );
    assert.throws(() => validateJsonNumberTokens('{"value":1e-400}'), ValidationError);
    assert.throws(
      () => validateJsonNumberTokens('{"value":9007199254740991.1}'),
      ValidationError,
    );
  });

  it("parses bounded pagination", () => {
    assert.deepEqual(parsePagination({}), { limit: 20, offset: 0 });
    assert.deepEqual(parsePagination({ limit: "100", offset: "50" }), {
      limit: 100,
      offset: 50,
    });
    assert.throws(() => parsePagination({ limit: "101" }), ValidationError);
    assert.throws(() => parsePagination({ offset: "-1" }), ValidationError);
  });
});
