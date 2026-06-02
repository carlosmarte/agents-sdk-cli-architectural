import { ProviderError, RateLimitError, TimeoutError } from "../errors.js";

/**
 * Options for {@link withResilience}. `maxRetries` + `timeoutMs` are required
 * (the orchestrator sources them from `ProviderConfig`); the rest have defaults.
 * `random` is injectable so tests can make jitter deterministic.
 */
export interface ResilienceOptions {
  maxRetries: number;
  timeoutMs: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  idempotencyKey?: string;
  /** External abort that, when fired, also aborts the in-flight attempt. */
  signal?: AbortSignal;
  random?: () => number;
}

const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 10_000;

/** Context handed to the wrapped thunk on every attempt (stable idempotency key). */
export interface ResilienceCallContext {
  idempotencyKey?: string;
  signal: AbortSignal;
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retriable iff the error is part of the Feature 02 taxonomy that the design
 * marks safe to replay: a rate limit, a timeout, or any `ProviderError` whose
 * `retriable` flag is set (e.g. a mapped 5xx). Everything else — auth failures,
 * non-retriable provider errors — propagates immediately.
 */
export function isRetriable(err: unknown): boolean {
  if (err instanceof RateLimitError || err instanceof TimeoutError) return true;
  if (err instanceof ProviderError) return err.retriable === true;
  return false;
}

/**
 * Full-jitter exponential backoff: `min(base * 2^attempt, max)` scaled by a
 * random factor in [0, 1). `attempt` is 0-based, so the first retry waits up to
 * `base`, the next up to `2*base`, capped at `maxDelayMs`.
 */
export function computeBackoffMs(
  attempt: number,
  opts: ResilienceOptions,
): number {
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = opts.random ?? Math.random;
  return Math.min(base * 2 ** attempt, max) * random();
}

/**
 * Wrap the async thunk the orchestrator uses to invoke the resolved provider,
 * making it resilient *once* in `core` rather than in every adapter:
 *
 * - Each attempt is bounded by `timeoutMs` via an `AbortController`; on expiry
 *   the attempt is aborted and a `core` {@link TimeoutError} is raised (then
 *   itself subject to retry).
 * - Retriable errors are retried with exponential backoff + full jitter, capped
 *   by `maxRetries`; non-retriable errors propagate on the first attempt.
 * - The `idempotencyKey` is threaded unchanged into every attempt's context so
 *   retried requests are safe to replay.
 *
 * Provider-agnostic: it imports only the error taxonomy and native timers/abort
 * primitives — no adapter or SDK.
 */
export async function withResilience<T>(
  call: (ctx: ResilienceCallContext) => Promise<T>,
  opts: ResilienceOptions,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const ac = new AbortController();
    const onExternalAbort = () => ac.abort();
    // An already-fired or later-fired external signal aborts this attempt too.
    if (opts.signal) {
      if (opts.signal.aborted) ac.abort();
      else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
    try {
      return await call({ idempotencyKey: opts.idempotencyKey, signal: ac.signal });
    } catch (err) {
      // Distinguish a deadline abort from a provider-thrown error: a fired
      // abort means we hit the timeout, so surface a core TimeoutError.
      lastErr =
        ac.signal.aborted && !(err instanceof TimeoutError)
          ? new TimeoutError(`request exceeded ${opts.timeoutMs}ms`, { cause: err })
          : err;
      if (attempt < opts.maxRetries && isRetriable(lastErr)) {
        await sleep(computeBackoffMs(attempt, opts));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
  // Unreachable: the loop either returns or throws, but satisfies the type checker.
  throw lastErr;
}
