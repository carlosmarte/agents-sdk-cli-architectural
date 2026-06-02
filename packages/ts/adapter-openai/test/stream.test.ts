import { describe, expect, it, vi } from "vitest";

import type { StreamChunk } from "@llmorch/core";

import { OpenAIAdapter } from "../src/index.js";

const cfg = { provider: "openai", apiKey: "k" } as never;
const req = { model: "m", messages: [{ role: "user", content: "hi" }] } as never;

/** Recorded OpenAI SSE chunks: 3 content deltas, usage + finish on the last. */
const chunks = [
  { choices: [{ delta: { content: "Hel" } }] },
  { choices: [{ delta: { content: "lo" } }] },
  {
    choices: [{ delta: { content: "!" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 5 },
  },
];

async function* asyncStream<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}

function inject(adapter: OpenAIAdapter, create: unknown): OpenAIAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = {
    chat: { completions: { create } },
  };
  return adapter;
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe("OpenAIAdapter.stream", () => {
  it("emits a delta per content chunk then one terminal usage chunk", async () => {
    const create = vi.fn().mockResolvedValue(asyncStream(chunks));
    const out = await collect(inject(new OpenAIAdapter(cfg), create).stream(req));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
    const textDeltas = out.filter((c) => c.delta !== "").map((c) => c.delta);
    expect(textDeltas).toEqual(["Hel", "lo", "!"]);
    expect(textDeltas.join("")).toBe("Hello!");

    const terminal = out.at(-1)!;
    expect(terminal.delta).toBe("");
    expect(terminal.usage).toEqual({ promptTokens: 3, completionTokens: 5 });
    expect(terminal.finishReason).toBe("stop");
  });
});
