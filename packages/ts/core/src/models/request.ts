import { z } from "zod";

import { MessageSchema } from "./messages.js";

/** Reasoning effort hint for models that support it. */
export const ReasoningEffortSchema = z.enum(["low", "medium", "high"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/** A tool the model may call. `parameters` is an arbitrary JSON Schema object. */
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** How the model should select tools. */
export const ToolChoiceSchema = z.union([
  z.enum(["auto", "none", "required"]),
  z.object({ type: z.literal("tool"), name: z.string() }),
]);
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;

/** The provider-agnostic inbound request every adapter receives. */
export const ChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  toolChoice: ToolChoiceSchema.optional(),
  responseSchema: z.record(z.string(), z.unknown()).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
