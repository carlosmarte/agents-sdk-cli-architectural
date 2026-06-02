import type { ZodType } from "zod";

import type {
  ChatRequest,
  FinishReason,
  TokenUsage,
  ToolInvocationRequest,
  ToolResult,
  UnifiedResponse,
} from "./models/index.js";

/**
 * An incremental piece of a streamed response. `delta` is the text increment;
 * the optional fields appear on terminal/aggregate chunks.
 */
export interface StreamChunk {
  delta: string;
  toolCallDelta?: Partial<ToolInvocationRequest>;
  usage?: TokenUsage;
  finishReason?: FinishReason;
}

/**
 * The single seam between the orchestration core and every provider. Adapters
 * implement it; the SDK and CLI consume it. Nothing here knows about any
 * concrete provider SDK.
 */
export interface LLMProvider {
  readonly providerId: string;
  chat(req: ChatRequest): Promise<UnifiedResponse>;
  stream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown>;
  generateStructured<T>(req: ChatRequest, schema: ZodType<T>): Promise<T>;
  invokeTool(req: ChatRequest): Promise<UnifiedResponse>;
  resumeTool(req: ChatRequest, results: ToolResult[]): Promise<UnifiedResponse>;
}
