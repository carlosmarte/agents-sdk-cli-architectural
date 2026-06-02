/** @llmorch/core — Universal Interface, domain models, factory, orchestrator. */
export const CORE_PACKAGE = "@llmorch/core" as const;

export * from "./models/index.js";
export * from "./interface.js";
export * from "./errors.js";
export * from "./config.js";
export * from "./factory.js";
export * from "./orchestrator.js";
export * from "./schema.js";
export * from "./tools.js";
export {
  withResilience,
  isRetriable,
  computeBackoffMs,
  type ResilienceOptions,
  type ResilienceCallContext,
} from "./middleware/resilience.js";
export {
  type TelemetryHook,
  type TelemetryContext,
  NoopTelemetryHook,
  StructuredLogTelemetryHook,
} from "./telemetry.js";
export { runWithTrace, currentTraceId, newTraceId } from "./context.js";
export * from "./testing/index.js";
