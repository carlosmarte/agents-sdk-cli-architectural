import { describe, expect, it } from "vitest";

import { ChatRequestSchema, MessageSchema } from "../../src/models/index.js";

describe("Message", () => {
  it("validates string content", () => {
    const parsed = MessageSchema.parse({ role: "user", content: "hello" });
    expect(parsed.content).toBe("hello");
  });

  it("validates ContentBlock[] content", () => {
    const parsed = MessageSchema.parse({
      role: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "tool_result", toolCallId: "call_1", content: "42" },
      ],
    });
    expect(Array.isArray(parsed.content)).toBe(true);
  });

  it("rejects an unknown role", () => {
    expect(MessageSchema.safeParse({ role: "bogus", content: "x" }).success).toBe(
      false,
    );
  });
});

describe("ChatRequest", () => {
  const full = {
    model: "gpt-x",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.7,
    maxTokens: 256,
    reasoningEffort: "medium",
    tools: [{ name: "echo", description: "echoes", parameters: { type: "object" } }],
    toolChoice: { type: "tool", name: "echo" },
    responseSchema: { type: "object" },
  };

  it("round-trips a fully-populated request through JSON", () => {
    const parsed = ChatRequestSchema.parse(full);
    const roundTripped = ChatRequestSchema.parse(
      JSON.parse(JSON.stringify(parsed)),
    );
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects out-of-range temperature", () => {
    expect(ChatRequestSchema.safeParse({ ...full, temperature: 5 }).success).toBe(
      false,
    );
  });

  it("rejects a missing model", () => {
    const { model: _model, ...withoutModel } = full;
    expect(ChatRequestSchema.safeParse(withoutModel).success).toBe(false);
  });
});
