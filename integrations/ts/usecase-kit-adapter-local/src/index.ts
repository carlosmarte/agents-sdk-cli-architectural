/**
 * @llmorch-int/usecase-kit-adapter-local — TS use-case kit for a local / self-hosted or private LLM endpoint.
 *
 * Pattern 1 of 3 (see ../README.md). Wraps `@llmorch/sdk`'s `createOrchestrator`
 * with the `local` provider and exposes idiomatic, fully-typed helpers for the
 * real modalities — chat, streaming, structured output, tool calling, multi-
 * provider fallback, and telemetry. It duplicates NO port logic: every call goes
 * through the canonical orchestrator + adapter.
 */
import type {
  Message,
  Orchestrator,
  ProviderConfig,
  TelemetryHook,
  ToolDefinition,
  ToolResult,
  UnifiedResponse,
} from "@llmorch/core";
import { createOrchestrator } from "@llmorch/sdk";
import type { ZodType } from "zod";

/** The provider id this kit targets. */
export const PROVIDER_ID = "local" as const;
/** Model used when neither the call nor the kit options specify one. */
export const DEFAULT_MODEL = "llama3.2";
/** Environment variable read for the API key when `apiKey` is not passed. */
export const API_KEY_ENV = "LLMORCH_LOCAL_API_KEY";
/** Default endpoint when none is supplied (Ollama's OpenAI-compatible path); override via `baseUrl` / `LLMORCH_BASE_URL` for LM Studio, vLLM, or a private Azure deployment. */
export const BASE_URL = "http://localhost:11434/v1";

/** Options for {@link createLocalKit}. */
export interface LocalKitOptions {
  /** API key; defaults to `process.env.LLMORCH_LOCAL_API_KEY`. */
  apiKey?: string;
  /** Default model for every call; defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Override the provider base URL. */
  baseUrl?: string;
  /** Default sampling temperature applied when a call omits one. */
  temperature?: number;
  /** Default max output tokens applied when a call omits one. */
  maxTokens?: number;
  /** Telemetry hook forwarded to the orchestrator. */
  telemetry?: TelemetryHook;
  /** Providers appended after `local` to form an ordered fallback chain. */
  fallback?: Array<Partial<ProviderConfig>>;
  /** Inject a prebuilt orchestrator (tests / advanced wiring). */
  orchestrator?: Orchestrator;
}

/** Per-call overrides layered on top of the kit defaults. */
export interface CallOptions {
  /** Prepended as a `system` message. */
  system?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Host-side tool implementations, keyed by tool name. */
export type ToolHandlers = Record<
  string,
  (args: Record<string, unknown>) => string | Promise<string>
>;

/** The typed kit surface returned by {@link createLocalKit}. */
export interface LocalKit {
  readonly provider: typeof PROVIDER_ID;
  readonly model: string;
  readonly orchestrator: Orchestrator;
  /** One-shot prompt → assistant text. */
  ask(prompt: string, opts?: CallOptions): Promise<string>;
  /** Full chat over an explicit message list → normalized response. */
  chat(messages: Message[], opts?: CallOptions): Promise<UnifiedResponse>;
  /** Stream a prompt as text deltas (empty/terminal chunks filtered out). */
  stream(prompt: string, opts?: CallOptions): AsyncGenerator<string, void, unknown>;
  /** Prompt → value validated against a Zod schema (structured output). */
  extract<T>(prompt: string, schema: ZodType<T>, opts?: CallOptions): Promise<T>;
  /** Single-round tool loop: invoke → run handlers → resume → final answer. */
  runTools(
    prompt: string,
    tools: ToolDefinition[],
    handlers: ToolHandlers,
    opts?: CallOptions,
  ): Promise<UnifiedResponse>;
}

/**
 * Build a use-case kit for a local / self-hosted or private LLM endpoint. With no options it reads the key from
 * `process.env.LLMORCH_LOCAL_API_KEY` and targets {@link DEFAULT_MODEL}; pass `fallback` to add
 * downstream providers, or `orchestrator` to inject your own.
 */
export function createLocalKit(
  options: LocalKitOptions = {},
): LocalKit {
  const model = options.model ?? DEFAULT_MODEL;
  const apiKey = options.apiKey ?? process.env.LLMORCH_LOCAL_API_KEY;
  const baseUrl = options.baseUrl ?? BASE_URL;
  const defaultTemperature = options.temperature;
  const defaultMaxTokens = options.maxTokens;

  const orchestrator =
    options.orchestrator ??
    createOrchestrator(
      [
        { provider: PROVIDER_ID, apiKey, baseUrl, defaultModel: model },
        ...(options.fallback ?? []),
      ],
      { telemetry: options.telemetry },
    );

  /** Merge kit defaults + per-call overrides into a normalized request. */
  function buildRequest(messages: Message[], opts: CallOptions = {}) {
    const full: Message[] = opts.system
      ? [{ role: "system", content: opts.system }, ...messages]
      : messages;
    const temperature = opts.temperature ?? defaultTemperature;
    const maxTokens = opts.maxTokens ?? defaultMaxTokens;
    return {
      model: opts.model ?? model,
      messages: full,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
  }

  return {
    provider: PROVIDER_ID,
    model,
    orchestrator,

    async ask(prompt, opts) {
      const res = await orchestrator.chat(
        buildRequest([{ role: "user", content: prompt }], opts),
      );
      return res.text;
    },

    chat(messages, opts) {
      return orchestrator.chat(buildRequest(messages, opts));
    },

    async *stream(prompt, opts) {
      const req = buildRequest([{ role: "user", content: prompt }], opts);
      for await (const chunk of orchestrator.stream(req)) {
        if (chunk.delta) yield chunk.delta;
      }
    },

    extract(prompt, schema, opts) {
      return orchestrator.generateStructured(
        buildRequest([{ role: "user", content: prompt }], opts),
        schema,
      );
    },

    async runTools(prompt, tools, handlers, opts) {
      const req = {
        ...buildRequest([{ role: "user", content: prompt }], opts),
        tools,
      };
      const first = await orchestrator.invokeTool(req);
      if (first.finishReason !== "tool_use" || first.toolCalls.length === 0) {
        return first;
      }
      const results: ToolResult[] = [];
      for (const call of first.toolCalls) {
        const handler = handlers[call.name];
        const content = handler
          ? await handler(call.arguments)
          : `No handler registered for tool "${call.name}".`;
        results.push({ id: call.id, name: call.name, content });
      }
      return orchestrator.resumeTool(req, results);
    },
  };
}
