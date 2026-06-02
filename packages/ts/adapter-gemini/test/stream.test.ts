import { describe, expect, it, vi } from "vitest";

import type { StreamChunk } from "@llmorch/core";

import { GeminiAdapter } from "../src/index.js";

const cfg = { provider: "gemini", apiKey: "k" } as never;
const req = { model: "m", messages: [{ role: "user", content: "hi" }] } as never;

/** Recorded Gemini stream blocks: `.text` deltas, aggregate usage on the last. */
const chunks = [
  { text: "Hel" },
  { text: "lo" },
  {
    text: "!",
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 },
    candidates: [{ finishReason: "STOP" }],
  },
];

async function* asyncStream<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}

function inject(adapter: GeminiAdapter, generateContentStream: unknown): GeminiAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = {
    models: { generateContentStream },
    chats: { create: vi.fn() },
  };
  return adapter;
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe("GeminiAdapter.stream", () => {
  it("emits a delta per block then one terminal usage chunk (stateless path)", async () => {
    const gcs = vi.fn().mockResolvedValue(asyncStream(chunks));
    const adapter = inject(new GeminiAdapter(cfg), gcs);
    const chats = (adapter as unknown as { cachedClient: { chats: { create: unknown } } })
      .cachedClient.chats.create;
    const out = await collect(adapter.stream(req));

    expect(out.filter((c) => c.delta !== "").map((c) => c.delta).join("")).toBe(
      "Hello!",
    );
    const terminal = out.at(-1)!;
    expect(terminal.delta).toBe("");
    expect(terminal.usage).toEqual({ promptTokens: 3, completionTokens: 5 });
    expect(terminal.finishReason).toBe("stop");
    // Stateless streaming — never the chats session API.
    expect(chats).not.toHaveBeenCalled();
  });
});
