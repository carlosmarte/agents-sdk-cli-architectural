import { describe, expect, it } from "vitest";

import { type AnthropicStreamEvent, anthropicSseToChunks } from "../src/stream.js";
import type { StreamChunk } from "@llmorch/core";

/** A full recorded Anthropic SSE lifecycle: structural events wrap 3 text deltas. */
const lifecycle: AnthropicStreamEvent[] = [
  { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: "content_block_start" },
  { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "!" } },
  { type: "content_block_stop" },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
  { type: "message_stop" },
];

async function collect(events: AnthropicStreamEvent[]): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of anthropicSseToChunks(events)) out.push(c);
  return out;
}

describe("anthropicSseToChunks", () => {
  it("surfaces only content_block_delta text, filtering every structural event", async () => {
    const chunks = await collect(lifecycle);
    // 3 text deltas + exactly 1 terminal chunk — structural events yield nothing.
    expect(chunks).toHaveLength(4);
    const textDeltas = chunks.filter((c) => c.delta !== "").map((c) => c.delta);
    expect(textDeltas).toEqual(["Hel", "lo", "!"]);
  });

  it("closes with a single terminal chunk carrying merged usage + finishReason", async () => {
    const chunks = await collect(lifecycle);
    const terminal = chunks.at(-1)!;
    expect(terminal.delta).toBe("");
    expect(terminal.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(terminal.finishReason).toBe("stop");
    // No earlier chunk carries usage/finishReason — the terminal is the only one.
    expect(chunks.slice(0, -1).every((c) => !c.usage && !c.finishReason)).toBe(true);
  });

  it("reconstructs the full text by concatenating the deltas", async () => {
    const chunks = await collect(lifecycle);
    expect(chunks.map((c) => c.delta).join("")).toBe("Hello!");
  });
});
