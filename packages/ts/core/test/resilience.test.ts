import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from "../src/errors.js";
import {
  computeBackoffMs,
  type ResilienceCallContext,
  withResilience,
} from "../src/middleware/resilience.js";

const opts = { providerId: "p" };

describe("withResilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a retriable error N times then resolves (call count N+1)", async () => {
    const thunk = vi
      .fn<(ctx: ResilienceCallContext) => Promise<string>>()
      .mockRejectedValueOnce(new RateLimitError("x", opts))
      .mockRejectedValueOnce(new RateLimitError("x", opts))
      .mockResolvedValue("ok");
    const p = withResilience(thunk, { maxRetries: 3, timeoutMs: 1000, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(thunk).toHaveBeenCalledTimes(3);
  });

  it("re-throws a non-retriable error on the first attempt (no retry)", async () => {
    const thunk = vi
      .fn<(ctx: ResilienceCallContext) => Promise<string>>()
      .mockRejectedValue(new AuthenticationError("nope", opts));
    const p = withResilience(thunk, { maxRetries: 3, timeoutMs: 1000, baseDelayMs: 1 });
    const assertion = expect(p).rejects.toBeInstanceOf(AuthenticationError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it("aborts a never-resolving attempt and surfaces a TimeoutError after retries", async () => {
    // Resolves only when its attempt's signal aborts — i.e. on the deadline.
    const thunk = vi.fn((ctx: ResilienceCallContext) => {
      return new Promise<string>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const p = withResilience(thunk, { maxRetries: 2, timeoutMs: 10, baseDelayMs: 1 });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.runAllTimersAsync();
    await assertion;
    // maxRetries=2 → 3 attempts, each timed out.
    expect(thunk).toHaveBeenCalledTimes(3);
  });

  it("produces jittered, exponentially-growing, capped delays", () => {
    const seqA = [0.1, 0.5, 0.9];
    const seqB = [0.2, 0.4, 0.8];
    let ia = 0;
    let ib = 0;
    const o = { maxRetries: 3, timeoutMs: 1000, baseDelayMs: 100, maxDelayMs: 1000 };
    const delaysA = [0, 1, 2].map((k) =>
      computeBackoffMs(k, { ...o, random: () => seqA[ia++]! }),
    );
    const delaysB = [0, 1, 2].map((k) =>
      computeBackoffMs(k, { ...o, random: () => seqB[ib++]! }),
    );
    expect(delaysA).not.toEqual(delaysB);
    for (const d of [...delaysA, ...delaysB]) {
      expect(d).toBeLessThanOrEqual(o.maxDelayMs);
    }
    // ceiling (random→1) grows exponentially until the cap.
    expect(computeBackoffMs(0, { ...o, random: () => 1 })).toBe(100);
    expect(computeBackoffMs(1, { ...o, random: () => 1 })).toBe(200);
    expect(computeBackoffMs(4, { ...o, random: () => 1 })).toBe(1000); // capped
  });

  it("threads the idempotency key unchanged through every attempt", async () => {
    const seen: (string | undefined)[] = [];
    const thunk = vi.fn((ctx: ResilienceCallContext) => {
      seen.push(ctx.idempotencyKey);
      if (seen.length < 2) return Promise.reject(new RateLimitError("x", opts));
      return Promise.resolve("ok");
    });
    const p = withResilience(thunk, {
      maxRetries: 1,
      timeoutMs: 1000,
      baseDelayMs: 1,
      idempotencyKey: "k1",
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(seen).toEqual(["k1", "k1"]);
  });

  it("retries a ProviderError only when its retriable flag is set", async () => {
    const retriable = vi
      .fn<(ctx: ResilienceCallContext) => Promise<string>>()
      .mockRejectedValueOnce(new ProviderError("5xx", { ...opts, retriable: true }))
      .mockResolvedValue("ok");
    const p1 = withResilience(retriable, { maxRetries: 2, timeoutMs: 1000, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    await expect(p1).resolves.toBe("ok");
    expect(retriable).toHaveBeenCalledTimes(2);

    const fatal = vi
      .fn<(ctx: ResilienceCallContext) => Promise<string>>()
      .mockRejectedValue(new ProviderError("4xx", opts));
    const p2 = withResilience(fatal, { maxRetries: 2, timeoutMs: 1000, baseDelayMs: 1 });
    const assertion = expect(p2).rejects.toBeInstanceOf(ProviderError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fatal).toHaveBeenCalledTimes(1);
  });
});
