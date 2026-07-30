export class CapacityLimiter {
  readonly limit: number;
  #active = 0;

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Capacity limit must be a positive integer");
    }
    this.limit = limit;
  }

  get active(): number {
    return this.#active;
  }

  tryAcquire(): (() => void) | undefined {
    if (this.#active >= this.limit) return undefined;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}
