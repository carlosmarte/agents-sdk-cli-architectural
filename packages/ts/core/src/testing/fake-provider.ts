import type { ZodType } from "zod";

import type { LLMProvider, StreamChunk } from "../interface.js";
import type { ChatRequest } from "../models/index.js";
import {
  type TokenUsage,
  type ToolInvocationRequest,
  type ToolResult,
  type UnifiedResponse,
  UnifiedResponseSchema,
} from "../models/index.js";

/** Canned configuration for {@link FakeProvider}. All fields have defaults. */
export interface FakeProviderConfig {
  text?: string;
  toolCalls?: ToolInvocationRequest[];
  usage?: TokenUsage;
  chunks?: StreamChunk[];
  /** Object returned (after schema validation) by `generateStructured`. */
  structured?: unknown;
}

const DEFAULT_TEXT = "Hello from the fake provider.";
const DEFAULT_USAGE: TokenUsage = { promptTokens: 1, completionTokens: 1 };

/**
 * In-memory {@link LLMProvider} with deterministic canned responses — no network
 * and no provider SDK. Proves the interface is implementable and serves as the
 * reusable fixture for testing the orchestrator, middleware, SDK, and CLI.
 */
export class FakeProvider implements LLMProvider {
  readonly providerId = "fake";

  private readonly text: string;
  private readonly toolCalls: ToolInvocationRequest[];
  private readonly usage: TokenUsage;
  private readonly chunks: StreamChunk[];
  private readonly structured: unknown;

  constructor(config: FakeProviderConfig = {}) {
    this.text = config.text ?? DEFAULT_TEXT;
    this.toolCalls = config.toolCalls ?? [];
    this.usage = config.usage ?? DEFAULT_USAGE;
    this.structured = config.structured ?? {};
    this.chunks = config.chunks ?? this.defaultChunks();
  }

  /** Split the canned text into two deltas; the last carries usage + finish. */
  private defaultChunks(): StreamChunk[] {
    const mid = Math.ceil(this.text.length / 2);
    return [
      { delta: this.text.slice(0, mid) },
      {
        delta: this.text.slice(mid),
        usage: this.usage,
        finishReason: "stop",
      },
    ];
  }

  async chat(_req: ChatRequest): Promise<UnifiedResponse> {
    return UnifiedResponseSchema.parse({
      text: this.text,
      usage: this.usage,
      toolCalls: [],
      finishReason: "stop",
    });
  }

  async *stream(_req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }

  async generateStructured<T>(_req: ChatRequest, schema: ZodType<T>): Promise<T> {
    return schema.parse(this.structured);
  }

  async invokeTool(req: ChatRequest): Promise<UnifiedResponse> {
    const toolCalls =
      this.toolCalls.length > 0
        ? this.toolCalls
        : [
            {
              id: "call_1",
              name: req.tools?.[0]?.name ?? "echo",
              arguments: {},
            },
          ];
    return UnifiedResponseSchema.parse({
      text: "",
      usage: this.usage,
      toolCalls,
      finishReason: "tool_use",
    });
  }

  /**
   * Resume after a halted tool call. Returns a deterministic final answer that
   * echoes the supplied results, mirroring how a real adapter would resume to a
   * `finishReason: "stop"` response once the host hands tool output back.
   */
  async resumeTool(
    _req: ChatRequest,
    results: ToolResult[],
  ): Promise<UnifiedResponse> {
    const summary = results.map((r) => `${r.name}=${r.content}`).join(", ");
    return UnifiedResponseSchema.parse({
      text: summary.length > 0 ? `Resumed with ${summary}.` : this.text,
      usage: this.usage,
      toolCalls: [],
      finishReason: "stop",
    });
  }
}
