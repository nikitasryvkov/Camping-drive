import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CapacityLimiter } from "../src/capacity-limiter.js";

describe("capacity limiter", () => {
  it("fails fast at capacity and safely releases a slot once", () => {
    const limiter = new CapacityLimiter(1);
    const release = limiter.tryAcquire();

    assert.equal(typeof release, "function");
    assert.equal(limiter.active, 1);
    assert.equal(limiter.tryAcquire(), undefined);

    release?.();
    release?.();
    assert.equal(limiter.active, 0);

    const secondRelease = limiter.tryAcquire();
    assert.equal(typeof secondRelease, "function");
    secondRelease?.();
  });
});
