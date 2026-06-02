import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** What rides in the per-call async context. */
export interface TraceStore {
  traceId: string;
}

/**
 * Per-call trace store bound to this module — explicitly *not* a global Hub.
 * Each `runWithTrace` establishes an isolated scope; concurrent orchestrator
 * calls (each in its own async context) carry independent trace ids.
 */
const als = new AsyncLocalStorage<TraceStore>();

/** Mint a fresh trace id. */
export const newTraceId = (): string => randomUUID();

/**
 * Run `fn` with `traceId` established as the current trace. Any nested function
 * — the resilience wrapper, the adapter, the telemetry hook — can read it via
 * {@link currentTraceId} without it being threaded through a parameter.
 */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return als.run({ traceId }, fn);
}

/** The trace id of the enclosing {@link runWithTrace}, or `undefined` outside one. */
export function currentTraceId(): string | undefined {
  return als.getStore()?.traceId;
}
