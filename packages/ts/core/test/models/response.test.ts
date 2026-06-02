import { describe, expect, it } from "vitest";

import {
  TokenUsageSchema,
  UnifiedResponseSchema,
} from "../../src/models/index.js";

describe("UnifiedResponse", () => {
  it("validates an empty toolCalls + stop finish", () => {
    const parsed = UnifiedResponseSchema.parse({
      text: "done",
      usage: { promptTokens: 1, completionTokens: 2 },
      toolCalls: [],
      finishReason: "stop",
    });
    expect(parsed.toolCalls).toHaveLength(0);
  });

  it("validates populated toolCalls + tool_use finish", () => {
    const parsed = UnifiedResponseSchema.parse({
      text: "",
      usage: { promptTokens: 1, completionTokens: 0 },
      toolCalls: [{ id: "call_1", name: "echo", arguments: { x: 1 } }],
      finishReason: "tool_use",
    });
    expect(parsed.finishReason).toBe("tool_use");
  });

  it("round-trips a fully-populated response (incl. reasoningTokens)", () => {
    const parsed = UnifiedResponseSchema.parse({
      text: "answer",
      usage: { promptTokens: 3, completionTokens: 4, reasoningTokens: 5 },
      toolCalls: [{ id: "c1", name: "t", arguments: {} }],
      finishReason: "length",
    });
    const roundTripped = UnifiedResponseSchema.parse(
      JSON.parse(JSON.stringify(parsed)),
    );
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects an unknown finishReason", () => {
    expect(
      UnifiedResponseSchema.safeParse({
        text: "x",
        usage: { promptTokens: 0, completionTokens: 0 },
        toolCalls: [],
        finishReason: "explode",
      }).success,
    ).toBe(false);
  });
});

describe("TokenUsage", () => {
  it("validates with reasoningTokens absent", () => {
    expect(
      TokenUsageSchema.safeParse({ promptTokens: 1, completionTokens: 1 })
        .success,
    ).toBe(true);
  });
});
