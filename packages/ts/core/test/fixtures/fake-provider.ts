import type { ZodType } from "zod";

import type { ProviderConfig } from "../../src/config.js";
import type { LLMProvider, StreamChunk } from "../../src/interface.js";
import type { ChatRequest, ToolResult, UnifiedResponse } from "../../src/models/index.js";

/**
 * Test double implementing `LLMProvider`. Records the `ProviderConfig` it was
 * constructed with and returns deterministic responses keyed by `providerId`,
 * so factory + orchestrator behavior is provable with zero real adapters.
 */
export class FakeProvider implements LLMProvider {
  readonly providerId: string;
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.providerId = config.provider;
  }

  async chat(_req: ChatRequest): Promise<UnifiedResponse> {
    return {
      text: `chat:${this.providerId}`,
      usage: { promptTokens: 1, completionTokens: 1 },
      toolCalls: [],
      finishReason: "stop",
    };
  }

  async *stream(_req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    yield { delta: `chat:${this.providerId}`, finishReason: "stop" };
  }

  async generateStructured<T>(_req: ChatRequest, schema: ZodType<T>): Promise<T> {
    return schema.parse({});
  }

  async invokeTool(_req: ChatRequest): Promise<UnifiedResponse> {
    return {
      text: "",
      usage: { promptTokens: 1, completionTokens: 1 },
      toolCalls: [{ id: "call_1", name: "echo", arguments: {} }],
      finishReason: "tool_use",
    };
  }

  async resumeTool(_req: ChatRequest, _results: ToolResult[]): Promise<UnifiedResponse> {
    return {
      text: `resume:${this.providerId}`,
      usage: { promptTokens: 1, completionTokens: 1 },
      toolCalls: [],
      finishReason: "stop",
    };
  }
}
