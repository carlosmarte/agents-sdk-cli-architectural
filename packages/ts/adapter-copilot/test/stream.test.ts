import { describe, expect, it, vi } from "vitest";

import type { StreamChunk } from "@llmorch/core";

import { CopilotAdapter } from "../src/index.js";

const cfg = { provider: "copilot", apiKey: "k" } as never;
const req = { model: "m", messages: [{ role: "user", content: "hi" }] } as never;

/**
 * A streaming session fake: when `sendAndWait` is called it replays the deltas
 * through the `assistant.message_delta` subscribers, then fires `session.idle`
 * — the same event sequence the SDK emits with `streaming: true`.
 */
function streamingClient(deltas: string[]) {
  const handlers: Record<string, Array<(ev: unknown) => void>> = {};
  const on = vi.fn((event: string, h: (ev: unknown) => void) => {
    (handlers[event] ??= []).push(h);
    return () => {};
  });
  const sendAndWait = vi.fn(async () => {
    for (const d of deltas) {
      for (const h of handlers["assistant.message_delta"] ?? []) h({ data: { content: d } });
    }
    for (const h of handlers["session.idle"] ?? []) h({});
    return { data: { content: deltas.join("") } };
  });
  const createSession = vi.fn(async () => ({ sendAndWait, on }));
  return { client: { createSession, stop: vi.fn() }, createSession };
}

function inject(adapter: CopilotAdapter, client: unknown): CopilotAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = client;
  return adapter;
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe("CopilotAdapter.stream", () => {
  it("opens a streaming session and yields message deltas then a terminal chunk", async () => {
    const f = streamingClient(["Hel", "lo", "!"]);
    const out = await collect(inject(new CopilotAdapter(cfg), f.client).stream(req));

    expect(f.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ streaming: true }),
    );
    expect(out.filter((c) => c.delta !== "").map((c) => c.delta).join("")).toBe("Hello!");

    const terminal = out.at(-1)!;
    expect(terminal.delta).toBe("");
    expect(terminal.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(terminal.finishReason).toBe("stop");
  });
});
