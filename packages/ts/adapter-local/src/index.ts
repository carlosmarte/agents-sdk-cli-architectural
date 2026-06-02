import OpenAI from "openai";
import type { ZodType } from "zod";

import {
  AuthenticationError,
  type ChatRequest,
  type FinishReason,
  type LLMProvider,
  OrchestrationError,
  ProviderError,
  type ProviderConfig,
  RateLimitError,
  type StreamChunk,
  type TokenUsage,
  type ToolChoice,
  type ToolInvocationRequest,
  type ToolResult,
  type UnifiedResponse,
  parseOrThrow,
  registerProvider,
  toOpenAITools,
  zodToJsonSchema,
} from "@llmorch/core";

/**
 * Default endpoint when none is supplied via config/env: Ollama's
 * OpenAI-compatible path. Override with `baseUrl` / `LLMORCH_BASE_URL`
 * (e.g. LM Studio `http://localhost:1234/v1`, vLLM, llama.cpp server, LocalAI).
 */
export const DEFAULT_LOCAL_BASE_URL = "http://localhost:11434/v1";

/**
 * Placeholder credential for servers that need none. The OpenAI client refuses
 * to construct with an empty key, so we hand it a sentinel; a real key (set via
 * `LLMORCH_LOCAL_API_KEY` for a proxied endpoint) takes precedence.
 */
const PLACEHOLDER_API_KEY = "local";

/** Minimal structural view of the OpenAI-compatible client surface used here. */
interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** A single SSE chunk from a streamed completion. */
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

interface OpenAILike {
  chat: {
    completions: {
      create(params: Record<string, unknown>): Promise<OpenAIChatResponse>;
    };
  };
}

/** Read an HTTP status off an unknown provider error. */
function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; response?: { status?: number } };
  return e.status ?? e.response?.status;
}

/** Detect a "server unreachable" failure — the dominant local-LLM footgun. */
function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; name?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    e.name === "APIConnectionError"
  );
}

/** OpenAI-compatible finish_reason → normalized FinishReason. */
function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "stop";
  }
}

/** Usage block → normalized TokenUsage. */
function mapUsage(usage: OpenAIChatResponse["usage"]): TokenUsage {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  };
}

/** Normalized ToolChoice → OpenAI-compatible `tool_choice`. */
export function mapToolChoice(choice: ToolChoice): unknown {
  if (typeof choice === "string") return choice;
  return { type: "function", function: { name: choice.name } };
}

/**
 * Build a system instruction that pins the model to emit JSON conforming to the
 * given schema. Local servers rarely implement OpenAI's strict `json_schema`
 * response format, but almost all honor `json_object` mode — so we steer via the
 * prompt and still validate against the original schema afterwards.
 */
function jsonSchemaInstruction(schema: unknown): string {
  return (
    "You must respond with a single JSON object and nothing else. " +
    "It must validate against this JSON Schema:\n" +
    JSON.stringify(schema)
  );
}

/**
 * The bring-your-own-endpoint adapter. A private / self-hosted LLM (Ollama,
 * LM Studio, vLLM, llama.cpp server, LocalAI, …) almost always exposes an
 * OpenAI-compatible `/v1/chat/completions` surface, so this adapter reuses the
 * OpenAI client pointed at a user-supplied `baseUrl` and flows through the exact
 * same orchestration pipeline (resilience, telemetry, tools) as the hosted
 * providers. Self-registers under id `local` at module load.
 */
export class LocalAdapter implements LLMProvider {
  readonly providerId = "local";
  private readonly config: ProviderConfig;
  private readonly baseUrl: string;
  private cachedClient?: OpenAILike;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? DEFAULT_LOCAL_BASE_URL;
  }

  /** Lazily construct the client so registration never needs an endpoint/key. */
  private get client(): OpenAILike {
    if (!this.cachedClient) {
      this.cachedClient = new OpenAI({
        apiKey: this.config.apiKey ?? PLACEHOLDER_API_KEY,
        baseURL: this.baseUrl,
        defaultHeaders: this.config.extraHeaders,
      }) as unknown as OpenAILike;
    }
    return this.cachedClient;
  }

  mapRequest(req: ChatRequest): Record<string, unknown> {
    const params: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
    };
    if (req.temperature !== undefined) params.temperature = req.temperature;
    if (req.maxTokens !== undefined) params.max_tokens = req.maxTokens;
    return params;
  }

  mapResponse(res: OpenAIChatResponse): UnifiedResponse {
    const choice = res.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      usage: mapUsage(res.usage),
      toolCalls: [],
      finishReason: mapFinishReason(choice?.finish_reason),
    };
  }

  /** Map a completion that may carry tool calls into a (possibly halting) response. */
  private toToolResponse(res: OpenAIChatResponse): UnifiedResponse {
    const choice = res.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];
    const toolCalls: ToolInvocationRequest[] = calls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));
    return {
      text: choice?.message?.content ?? "",
      usage: mapUsage(res.usage),
      toolCalls,
      finishReason:
        toolCalls.length > 0 ? "tool_use" : mapFinishReason(choice?.finish_reason),
    };
  }

  mapError(err: unknown): OrchestrationError {
    const opts = { providerId: this.providerId, cause: err };
    const status = statusOf(err);
    if (status === 401 || status === 403)
      return new AuthenticationError("local: unauthorized", opts);
    if (status === 429) return new RateLimitError("local: rate limited", opts);
    if (isConnectionError(err))
      return new ProviderError(
        `local: cannot reach the server at ${this.baseUrl} — is it running? ` +
          "Set baseUrl / LLMORCH_BASE_URL to your endpoint.",
        { ...opts, retriable: true },
      );
    if (status !== undefined && status >= 500)
      return new ProviderError("local: server error", { ...opts, retriable: true });
    return new ProviderError("local: request failed", opts);
  }

  async chat(req: ChatRequest): Promise<UnifiedResponse> {
    try {
      const res = await this.client.chat.completions.create(this.mapRequest(req));
      return this.mapResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    let raw: AsyncIterable<OpenAIStreamChunk>;
    try {
      raw = (await this.client.chat.completions.create({
        ...this.mapRequest(req),
        stream: true,
      })) as unknown as AsyncIterable<OpenAIStreamChunk>;
    } catch (err) {
      throw this.mapError(err);
    }
    let usage: TokenUsage | undefined;
    let finishReason: FinishReason | undefined;
    for await (const chunk of raw) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) yield { delta };
      if (chunk.usage) usage = mapUsage(chunk.usage);
      if (choice?.finish_reason) finishReason = mapFinishReason(choice.finish_reason);
    }
    yield {
      delta: "",
      usage: usage ?? { promptTokens: 0, completionTokens: 0 },
      finishReason: finishReason ?? "stop",
    };
  }

  async generateStructured<T>(req: ChatRequest, schema: ZodType<T>): Promise<T> {
    try {
      const jsonSchema = zodToJsonSchema(schema);
      const params = this.mapRequest(req);
      // Steer via a prepended system instruction + json_object mode — broadly
      // supported by local servers, unlike OpenAI's strict json_schema format.
      params.messages = [
        { role: "system", content: jsonSchemaInstruction(jsonSchema) },
        ...(params.messages as unknown[]),
      ];
      params.response_format = { type: "json_object" };
      const res = await this.client.chat.completions.create(params);
      const content = res.choices?.[0]?.message?.content ?? "";
      // Always validate against the ORIGINAL schema — recovers any constraint a
      // local model silently ignored.
      return parseOrThrow(schema, JSON.parse(content || "{}"));
    } catch (err) {
      if (err instanceof OrchestrationError) throw err;
      throw this.mapError(err);
    }
  }

  async invokeTool(req: ChatRequest): Promise<UnifiedResponse> {
    try {
      const params = this.mapRequest(req);
      if (req.tools?.length) params.tools = toOpenAITools(req.tools);
      if (req.toolChoice) params.tool_choice = mapToolChoice(req.toolChoice);
      const res = await this.client.chat.completions.create(params);
      return this.toToolResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Resume after the host executed the halted tool call(s): format each
   * {@link ToolResult} as a `tool` message, append to the serialized history,
   * and re-call to obtain the final answer.
   */
  async resumeTool(req: ChatRequest, results: ToolResult[]): Promise<UnifiedResponse> {
    try {
      const base = this.mapRequest(req);
      base.messages = [
        ...(base.messages as unknown[]),
        ...results.map((r) => ({
          role: "tool",
          tool_call_id: r.id,
          content: r.content,
        })),
      ];
      const res = await this.client.chat.completions.create(base);
      return this.toToolResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }
}

registerProvider("local", LocalAdapter);
