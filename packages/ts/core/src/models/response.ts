import { z } from "zod";

/** Why generation stopped. */
export const FinishReasonSchema = z.enum([
  "stop",
  "length",
  "tool_use",
  "content_filter",
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

/** Normalized token accounting. `reasoningTokens` is optional. */
export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** A tool the model asks the host to run. */
export const ToolInvocationRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolInvocationRequest = z.infer<typeof ToolInvocationRequestSchema>;

/** What the host hands back for a tool call on the next turn. */
export const ToolResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/** The single normalized outbound shape every adapter produces. */
export const UnifiedResponseSchema = z.object({
  text: z.string(),
  usage: TokenUsageSchema,
  toolCalls: z.array(ToolInvocationRequestSchema),
  finishReason: FinishReasonSchema,
});
export type UnifiedResponse = z.infer<typeof UnifiedResponseSchema>;
