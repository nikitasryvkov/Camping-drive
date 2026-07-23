import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPassword, verifyPassword, verifyPasswordOrDummy } from "../src/password.js";

describe("administrator passwords", () => {
  it("hashes passwords with a random salt and verifies the exact value", async () => {
    const password = "a secure password with spaces ";
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    assert.match(firstHash, /^scrypt\$32768\$8\$1\$/);
    assert.notEqual(firstHash, secondHash);
    assert.equal(await verifyPassword(password, firstHash), true);
    assert.equal(await verifyPassword(password.trim(), firstHash), false);
    assert.equal(await verifyPassword("wrong password", firstHash), false);
  });

  it("rejects malformed or unsupported password hashes", async () => {
    assert.equal(await verifyPassword("password", "not-a-password-hash"), false);
    assert.equal(await verifyPassword("password", "scrypt$999999$8$1$salt$key"), false);
    assert.equal(await verifyPassword("password", "scrypt$32768$8$1$salt$key$extra"), false);
  });

  it("performs dummy verification for an unknown administrator", async () => {
    assert.equal(await verifyPasswordOrDummy("unknown password", undefined), false);
  });
});
