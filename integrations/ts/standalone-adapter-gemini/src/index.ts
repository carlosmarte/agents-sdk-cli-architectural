/* Standalone copy of @llmorch/adapter-gemini (Pattern 2). Kept identical to
   the canonical adapter; fork/vendor this package independently. */
import { GoogleGenAI } from "@google/genai";
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
  type ReasoningEffort,
  type StreamChunk,
  type TokenUsage,
  type ToolInvocationRequest,
  type ToolResult,
  type UnifiedResponse,
  parseOrThrow,
  registerProvider,
  toGeminiTools,
  zodToJsonSchema,
} from "@llmorch/core";

interface GeminiPart {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
}

interface GeminiResponse {
  text?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: GeminiPart[] };
  }>;
}

interface GeminiLike {
  models: {
    generateContent(params: Record<string, unknown>): Promise<GeminiResponse>;
    generateContentStream(
      params: Record<string, unknown>,
    ): Promise<AsyncIterable<GeminiResponse>>;
  };
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; response?: { status?: number } };
  return e.status ?? e.response?.status;
}

function textOf(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** reasoningEffort → Gemini thinkingConfig (omitted when undefined). */
export function thinkingConfigFor(
  effort: ReasoningEffort | undefined,
): { thinkingBudget: number } | undefined {
  switch (effort) {
    case "low":
      return { thinkingBudget: 1024 };
    case "medium":
      return { thinkingBudget: 8192 };
    case "high":
      return { thinkingBudget: 24576 };
    default:
      return undefined;
  }
}

/** Gemini finishReason → normalized FinishReason. */
function mapFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    default:
      return "stop";
  }
}

/** Gemini usageMetadata → normalized TokenUsage. */
function mapUsage(usage: GeminiResponse["usageMetadata"]): TokenUsage {
  return {
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
  };
}

/** Map a normalized message to a Gemini Content (assistant → "model"). */
function toGeminiContent(m: Message): Record<string, unknown> {
  return {
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: textOf(m.content) }],
  };
}

/**
 * Gemini adapter — generation params nest inside `GenerateContentConfig`, and the
 * call is the stateless `models.generateContent` / `generateContentStream`, never
 * the stateful session API. For tool calling, the SDK's client-side
 * function-calling helper is turned off (mode `"NONE"` + disabled) so the model's
 * call returns to the host instead of being run, matching the other adapters'
 * manual loop. Self-registers under id `gemini` at module load.
 */
export class GeminiAdapter implements LLMProvider {
  readonly providerId = "gemini";
  private readonly config: ProviderConfig;
  private cachedClient?: GeminiLike;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private get client(): GeminiLike {
    if (!this.cachedClient) {
      this.cachedClient = new GoogleGenAI({
        apiKey: this.config.apiKey,
      }) as unknown as GeminiLike;
    }
    return this.cachedClient;
  }

  mapRequest(req: ChatRequest): Record<string, unknown> {
    const systemInstruction = req.messages
      .filter((m) => m.role === "system")
      .map((m) => textOf(m.content))
      .join("\n");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map(toGeminiContent);

    const config: Record<string, unknown> = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (req.temperature !== undefined) config.temperature = req.temperature;
    if (req.maxTokens !== undefined) config.maxOutputTokens = req.maxTokens;
    const thinking = thinkingConfigFor(req.reasoningEffort);
    if (thinking) config.thinkingConfig = thinking;

    return { model: req.model, contents, config };
  }

  mapResponse(res: GeminiResponse): UnifiedResponse {
    return {
      text: res.text ?? "",
      usage: mapUsage(res.usageMetadata),
      toolCalls: [],
      finishReason: mapFinishReason(res.candidates?.[0]?.finishReason),
    };
  }

  /** Map a response that may carry `functionCall` parts into a (halting) response. */
  private toToolResponse(res: GeminiResponse): UnifiedResponse {
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const toolCalls: ToolInvocationRequest[] = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        // Gemini function calls carry no id; synthesize a stable one.
        id: p.functionCall?.id ?? `call_${i}`,
        name: p.functionCall?.name ?? "",
        arguments: p.functionCall?.args ?? {},
      }));
    return {
      text: res.text ?? "",
      usage: mapUsage(res.usageMetadata),
      toolCalls,
      finishReason:
        toolCalls.length > 0
          ? "tool_use"
          : mapFinishReason(res.candidates?.[0]?.finishReason),
    };
  }

  mapError(err: unknown): OrchestrationError {
    const opts = { providerId: this.providerId, cause: err };
    const status = statusOf(err);
    const message = String((err as { message?: string }).message ?? "");
    if (status === 401 || message.includes("PERMISSION_DENIED"))
      return new AuthenticationError("gemini: unauthorized", opts);
    if (status === 429 || message.includes("RESOURCE_EXHAUSTED"))
      return new RateLimitError("gemini: rate limited", opts);
    return new ProviderError("gemini: request failed", opts);
  }

  async chat(req: ChatRequest): Promise<UnifiedResponse> {
    try {
      const res = await this.client.models.generateContent(this.mapRequest(req));
      return this.mapResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    let raw: AsyncIterable<GeminiResponse>;
    try {
      raw = await this.client.models.generateContentStream(this.mapRequest(req));
    } catch (err) {
      throw this.mapError(err);
    }
    let usage: TokenUsage | undefined;
    let finishReason: FinishReason | undefined;
    for await (const chunk of raw) {
      if (chunk.text) yield { delta: chunk.text };
      if (chunk.usageMetadata) usage = mapUsage(chunk.usageMetadata);
      const reason = chunk.candidates?.[0]?.finishReason;
      if (reason) finishReason = mapFinishReason(reason);
    }
    yield {
      delta: "",
      usage: usage ?? { promptTokens: 0, completionTokens: 0 },
      finishReason: finishReason ?? "stop",
    };
  }

  async generateStructured<T>(req: ChatRequest, schema: ZodType<T>): Promise<T> {
    try {
      const params = this.mapRequest(req);
      const config = params.config as Record<string, unknown>;
      config.responseMimeType = "application/json";
      config.responseSchema = zodToJsonSchema(schema);
      const res = await this.client.models.generateContent(params);
      return parseOrThrow(schema, JSON.parse(res.text ?? "{}"));
    } catch (err) {
      if (err instanceof OrchestrationError) throw err;
      throw this.mapError(err);
    }
  }

  async invokeTool(req: ChatRequest): Promise<UnifiedResponse> {
    try {
      const params = this.mapRequest(req);
      const config = params.config as Record<string, unknown>;
      if (req.tools?.length) config.tools = toGeminiTools(req.tools);
      // Disable the SDK's client-side function-calling helper so the model's
      // call surfaces to the host (the manual halt loop) instead of being run.
      config.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      config.automaticFunctionCalling = { disable: true };
      const res = await this.client.models.generateContent(params);
      return this.toToolResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Resume after a halted tool call: append a `functionResponse` Part per
   * {@link ToolResult}, then re-call for the final answer. `ToolResult` carries no
   * function name, so the call id is reused as the response key.
   */
  async resumeTool(req: ChatRequest, results: ToolResult[]): Promise<UnifiedResponse> {
    try {
      const params = this.mapRequest(req);
      params.contents = [
        ...(params.contents as unknown[]),
        {
          role: "user",
          parts: results.map((r) => ({
            functionResponse: { name: r.name, response: { result: r.content } },
          })),
        },
      ];
      const res = await this.client.models.generateContent(params);
      return this.toToolResponse(res);
    } catch (err) {
      throw this.mapError(err);
    }
  }
}

registerProvider("gemini", GeminiAdapter);

/** Provider id this standalone adapter registers. */
export const PROVIDER_ID = "gemini" as const;
