import type { ZodType } from "zod";

import { type ProviderConfig, resolveConfig } from "./config.js";
import { currentTraceId, newTraceId, runWithTrace } from "./context.js";
import { OrchestrationError } from "./errors.js";
import { LLMFactory } from "./factory.js";
import type { LLMProvider, StreamChunk } from "./interface.js";
import { withResilience } from "./middleware/resilience.js";
import type {
  ChatRequest,
  TokenUsage,
  ToolResult,
  UnifiedResponse,
} from "./models/index.js";
import { NoopTelemetryHook, type TelemetryHook } from "./telemetry.js";

export interface OrchestratorOpts {
  telemetry?: TelemetryHook;
}

/** The facade the Application Core holds — the unified interface, sans `providerId`. */
export type Orchestrator = Pick<
  LLMProvider,
  "chat" | "stream" | "generateStructured" | "invokeTool" | "resumeTool"
>;

type ConfigInput = Partial<ProviderConfig> | Array<Partial<ProviderConfig>>;

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 };

/** Read a normalized `TokenUsage` off a result if it carries one, else zero. */
function usageOf(out: unknown): TokenUsage {
  const u = (out as { usage?: TokenUsage } | null)?.usage;
  return u ?? ZERO_USAGE;
}

/**
 * Build a provider-agnostic orchestrator from one config or an ordered fallback
 * chain. Each provider call is wrapped in {@link withResilience} (backoff +
 * jitter on retriable errors, per-attempt timeout, idempotency passthrough) and
 * runs inside a trace context so a `traceId` flows to nested calls and the
 * injected {@link TelemetryHook} without manual threading. A retriable
 * {@link OrchestrationError} that survives resilience fails over to the next
 * provider; a non-retriable error propagates immediately.
 */
export function createOrchestrator(
  config: ConfigInput,
  opts: OrchestratorOpts = {},
): Orchestrator {
  const resolved = (Array.isArray(config) ? config : [config]).map((c) =>
    resolveConfig(c),
  );
  const chain: Array<{ provider: LLMProvider; config: ProviderConfig }> =
    resolved.map((config) => ({
      provider: LLMFactory.create(config),
      config,
    }));
  const telemetry = opts.telemetry ?? NoopTelemetryHook;

  /**
   * Drive `call` across the fallback chain inside a fresh (or inherited) trace
   * context, firing telemetry start/end/error per attempt. `usage` extracts the
   * normalized `TokenUsage` reported to `onRequestEnd`.
   */
  function run<T>(
    method: string,
    call: (provider: LLMProvider) => Promise<T>,
    usage: (out: T) => TokenUsage,
  ): Promise<T> {
    const traceId = currentTraceId() ?? newTraceId();
    return runWithTrace(traceId, async () => {
      let lastErr: unknown;
      for (const { provider, config } of chain) {
        const ctx = { traceId, providerId: provider.providerId, method };
        telemetry.onRequestStart?.(ctx);
        try {
          const out = await withResilience(() => call(provider), {
            maxRetries: config.maxRetries ?? 2,
            timeoutMs: config.timeoutMs ?? 30_000,
          });
          telemetry.onRequestEnd?.(ctx, usage(out));
          return out;
        } catch (err) {
          telemetry.onError?.(ctx, err);
          lastErr = err;
          if (err instanceof OrchestrationError && err.retriable) continue;
          throw err;
        }
      }
      throw lastErr;
    });
  }

  async function* streamRun(
    req: ChatRequest,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const traceId = currentTraceId() ?? newTraceId();
    // Bind the trace for the duration of the generator (sync establish; the
    // generator body reads it via the captured `traceId`).
    let lastErr: unknown;
    for (const { provider } of chain) {
      const ctx = { traceId, providerId: provider.providerId, method: "stream" };
      telemetry.onRequestStart?.(ctx);
      try {
        let usage: TokenUsage = ZERO_USAGE;
        for await (const chunk of runWithTrace(traceId, () => provider.stream(req))) {
          if (chunk.delta) telemetry.onToken?.(ctx, chunk.delta);
          if (chunk.usage) usage = chunk.usage;
          yield chunk;
        }
        telemetry.onRequestEnd?.(ctx, usage);
        return;
      } catch (err) {
        telemetry.onError?.(ctx, err);
        lastErr = err;
        if (err instanceof OrchestrationError && err.retriable) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  return {
    chat: (req: ChatRequest): Promise<UnifiedResponse> =>
      run("chat", (p) => p.chat(req), usageOf),
    stream: (req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> =>
      streamRun(req),
    generateStructured: <T>(req: ChatRequest, schema: ZodType<T>): Promise<T> =>
      run(
        "generateStructured",
        (p) => p.generateStructured(req, schema),
        () => ZERO_USAGE,
      ),
    invokeTool: (req: ChatRequest): Promise<UnifiedResponse> =>
      run("invokeTool", (p) => p.invokeTool(req), usageOf),
    resumeTool: (req: ChatRequest, results: ToolResult[]): Promise<UnifiedResponse> =>
      run("resumeTool", (p) => p.resumeTool(req, results), usageOf),
  };
}
