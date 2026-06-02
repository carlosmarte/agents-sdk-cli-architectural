import type { TokenUsage } from "./models/index.js";

/** Identifying context passed to every telemetry callback. */
export interface TelemetryContext {
  traceId: string;
  providerId: string;
  method: string;
}

/**
 * The observability seam the orchestrator drives. Every callback is optional so
 * an implementation opts into only the events it cares about; the orchestrator
 * guards each call with `?.`. The lifecycle per call is
 * `onRequestStart` → (`onToken`…)? → `onRequestEnd` on success, or
 * `onRequestStart` → `onError` on failure.
 */
export interface TelemetryHook {
  onRequestStart?(ctx: TelemetryContext): void;
  onRequestEnd?(ctx: TelemetryContext, usage: TokenUsage): void;
  onError?(ctx: TelemetryContext, err: unknown): void;
  onToken?(ctx: TelemetryContext, token: string): void;
}

/**
 * Default hook: telemetry is opt-in, so the absence of every callback makes all
 * events no-ops (the orchestrator calls them with `?.`). Never throws, never
 * emits output.
 */
export const NoopTelemetryHook: TelemetryHook = {};

/**
 * Emits one structured record per event, carrying the `traceId`, `providerId`,
 * and method, plus the normalized {@link TokenUsage} on `request.end`. The sink
 * defaults to `console.log(JSON.stringify(...))` but is injectable. Each method
 * swallows sink errors so telemetry can never break the request path.
 */
export class StructuredLogTelemetryHook implements TelemetryHook {
  constructor(
    private readonly log: (rec: object) => void = (r) =>
      console.log(JSON.stringify(r)),
  ) {}

  private emit(rec: object): void {
    try {
      this.log(rec);
    } catch {
      // Telemetry must never surface its own failure into the request path.
    }
  }

  onRequestStart(ctx: TelemetryContext): void {
    this.emit({ event: "request.start", ...ctx });
  }

  onRequestEnd(ctx: TelemetryContext, usage: TokenUsage): void {
    this.emit({ event: "request.end", ...ctx, usage });
  }

  onError(ctx: TelemetryContext, err: unknown): void {
    this.emit({
      event: "error",
      ...ctx,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  onToken(ctx: TelemetryContext, token: string): void {
    this.emit({ event: "token", ...ctx, token });
  }
}
