import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

import {
  AuthenticationError,
  type ChatRequest,
  type ContentBlock,
  type FinishReason,
  type LLMProvider,
  type Message,
  OrchestrationError,
  ProviderError,
  type ProviderConfig,
  RateLimitError,
  type StreamChunk,
  type TokenUsage,
  type ToolInvocationRequest,
  type ToolResult,
  type UnifiedResponse,
  parseOrThrow,
  registerProvider,
  toAnthropicTools,
  zodToJsonSchema,
} from "@llmorch/core";

import { type AnthropicStreamEvent, anthropicSseToChunks } from "./stream.js";

const DEFAULT_MAX_TOKENS = 1024;

/** Name + (stable) description of the single tool used to force structured output. */
const STRUCTURED_TOOL_NAME = "result";
const STRUCTURED_TOOL_DESC =
  "Return the result as structured JSON matching the provided schema.";

/**
 * Opt-in prompt caching. The Feature 02 `ChatRequest` has no caching flag, so
 * the adapter reads an optional `cacheControl` hint structurally (see Deviations).
 */
interface CacheableRequest extends ChatRequest {
  cacheControl?: boolean;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string | null;
}

interface AnthropicLike {
  messages: {
    create(params: Record<string, unknown>): Promise<AnthropicResponse>;
  };
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; response?: { status?: number } };
  return e.status ?? e.response?.status;
}

/** Flatten a Message's content to plain text. */
function textOf(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Wrap string content into Anthropic's text-block array; pass blocks through. */
function toAnthropicMessage(m: Message): Record<string, unknown> {
  return {
    role: m.role,
    content:
      typeof m.content === "string"
        ? [{ type: "text", text: m.content }]
        : m.content,
  };
}

/** Anthropic stop_reason → normalized FinishReason. */
function mapStopReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_use";
    default:
      return "stop";
  }
}

/** Anthropic usage block → normalized TokenUsage. */
function mapUsage(usage: AnthropicResponse["usage"]): TokenUsage {
  return {
    promptTokens: usage?.input_tokens ?? 0,
    completionTokens: usage?.output_tokens ?? 0,
  };
}

/**
 * Anthropic adapter — normalizes the divergences from the OpenAI baseline:
 * system extraction, mandatory `max_tokens`, text-block content, optional
 * `cache_control`, a dedicated streaming state machine, forced-`tool_use`
 * structured output, and `tool_result`-block resume. Self-registers under id
 * `anthropic` at module load.
 */
export class AnthropicAdapter implements LLMProvider {
  readonly providerId = "anthropic";
  private readonly config: ProviderConfig;
  private cachedClient?: AnthropicLike;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private get client(): AnthropicLike {
    if (!this.cachedClient) {
      this.cachedClient = new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
      }) as unknown as AnthropicLike;
    }
    return this.cachedClient;
  }

  mapRequest(req: ChatRequest): Record<string, unknown> {
    const systemText = req.messages
      .filter((m) => m.role === "system")
      .map((m) => textOf(m.content))
      .join("\n");
    const convo = req.messages.filter((m) => m.role !== "system");
    const cache = (req as CacheableRequest).cacheControl === true;

    const params: Record<string, unknown> = {
      model: req.model,
      messages: convo.map(toAnthropicMessage),
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (systemText) {
      params.system = cache
        ? [
            {
              type: "text",
              text: systemText,
              cache_control: { type: "ephemeral" },
            },
          ]
        : systemText;
    }
    if (req.temperature !== undefined) params.temperature = req.temperature;
    return params;
  }

  mapResponse(res: AnthropicResponse): UnifiedResponse {
    const textBlock = res.content?.find((b) => b.type === "text");
    return {
      text: textBlock?.text ?? "",
      usage: mapUsage(res.usage),
      toolCalls: [],
      finishReason: mapStopReason(res.stop_reason),
    };
  }

  /** Map a response that may carry `tool_use` blocks into a (halting) response. */
  private toToolResponse(res: AnthropicResponse): UnifiedResponse {
    const textBlock = res.content?.find((b) => b.type === "text");
    const toolCalls: ToolInvocationRequest[] = (res.content ?? [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id ?? "",
        name: b.name ?? "",
        arguments: b.input ?? {},
      }));
    return {
      text: textBlock?.text ?? "",
      usage: mapUsage(res.usage),
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_use" : mapStopReason(res.stop_reason),
    };
  }

  mapError(err: unknown): OrchestrationError {
    const opts = { providerId: this.providerId, cause: err };
    const status = statusOf(err);
    if (status === 401)
      return new AuthenticationError("anthropic: unauthorized", opts);
    if (status === 429)
      return new RateLimitError("anthropic: rate limited", opts);
    return new ProviderError("anthropic: request failed", opts);
  }

  async chat(req: ChatRequest): Promise<UnifiedResponse> {
    try {
      const res = await this.client.messages.create(this.mapRequest(req));
      return this.mapResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    let raw: AsyncIterable<AnthropicStreamEvent>;
    try {
      raw = (await this.client.messages.create({
        ...this.mapRequest(req),
        stream: true,
      })) as unknown as AsyncIterable<AnthropicStreamEvent>;
    } catch (err) {
      throw this.mapError(err);
    }
    yield* anthropicSseToChunks(raw);
  }

  async generateStructured<T>(req: ChatRequest, schema: ZodType<T>): Promise<T> {
    try {
      const tool = {
        name: STRUCTURED_TOOL_NAME,
        description: STRUCTURED_TOOL_DESC,
        input_schema: zodToJsonSchema(schema),
      };
      const res = await this.client.messages.create({
        ...this.mapRequest(req),
        tools: [tool],
        tool_choice: { type: "tool", name: STRUCTURED_TOOL_NAME },
      });
      const block = res.content?.find((b) => b.type === "tool_use");
      // Validate against the ORIGINAL schema — constraints Anthropic strips
      // (minLength/maxLength/regex) are still enforced here.
      return parseOrThrow(schema, block?.input ?? {});
    } catch (err) {
      if (err instanceof OrchestrationError) throw err;
      throw this.mapError(err);
    }
  }

  async invokeTool(req: ChatRequest): Promise<UnifiedResponse> {
    try {
      const params = this.mapRequest(req);
      if (req.tools?.length) params.tools = toAnthropicTools(req.tools);
      if (req.toolChoice && typeof req.toolChoice !== "string") {
        params.tool_choice = { type: "tool", name: req.toolChoice.name };
      }
      const res = await this.client.messages.create(params);
      return this.toToolResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Resume after a halted tool call: append a `user` message carrying one
   * `tool_result` block per {@link ToolResult}, then re-call for the final answer.
   */
  async resumeTool(req: ChatRequest, results: ToolResult[]): Promise<UnifiedResponse> {
    try {
      const base = this.mapRequest(req);
      base.messages = [
        ...(base.messages as unknown[]),
        {
          role: "user",
          content: results.map((r) => ({
            type: "tool_result",
            tool_use_id: r.id,
            content: r.content,
          })),
        },
      ];
      const res = await this.client.messages.create(base);
      return this.toToolResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }
}

registerProvider("anthropic", AnthropicAdapter);
