import { z } from "zod";

/** Conversation role. */
export const RoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type Role = z.infer<typeof RoleSchema>;

/** A single block of structured message content. Discriminated on `type`. */
export const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string(),
    content: z.string(),
  }),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/** A normalized message: content is either plain text or an array of blocks. */
export const MessageSchema = z.object({
  role: RoleSchema,
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
});
export type Message = z.infer<typeof MessageSchema>;
