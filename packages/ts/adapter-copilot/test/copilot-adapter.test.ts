import { describe, expect, it, vi } from "vitest";

import { AuthenticationError, RateLimitError, createProvider } from "@llmorch/core";

import { CopilotAdapter } from "../src/index.js";

const cfg = { provider: "copilot", apiKey: "k" } as never;
const req = {
  model: "gpt-4o",
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.5,
  maxTokens: 256,
} as never;

/**
 * The adapter constructs its `@github/copilot-sdk` client lazily via a private
 * `cachedClient`; we inject a recording fake directly rather than spawning the
 * Copilot CLI. A session exposes `sendAndWait` + `on`, mirroring the SDK.
 */
function fakeClient(opts: { content?: string; error?: unknown } = {}) {
  const sendAndWait = vi.fn(async () => {
    if (opts.error) throw opts.error;
    return { data: { content: opts.content ?? "hello" } };
  });
  const on = vi.fn(() => () => {});
  const createSession = vi.fn(async () => ({ sendAndWait, on }));
  return { client: { createSession, stop: vi.fn(async () => {}) }, createSession, sendAndWait };
}

function inject(adapter: CopilotAdapter, client: unknown): CopilotAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = client;
  return adapter;
}

describe("CopilotAdapter", () => {
  it("opens a session pinned to the request model", async () => {
    const f = fakeClient();
    await inject(new CopilotAdapter(cfg), f.client).chat(req);
    expect(f.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" }),
    );
  });

  it("flattens the message history into the session prompt", async () => {
    const f = fakeClient();
    await inject(new CopilotAdapter(cfg), f.client).chat(req);
    expect(f.sendAndWait).toHaveBeenCalledWith({ prompt: "hi" });
  });

  it("maps the reply content into a UnifiedResponse (usage zeroed)", async () => {
    const res = await inject(new CopilotAdapter(cfg), fakeClient({ content: "hello" }).client).chat(req);
    expect(res.text).toBe("hello");
    expect(res.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(res.toolCalls).toEqual([]);
    expect(res.finishReason).toBe("stop");
  });

  it("self-registers under 'copilot'", () => {
    expect(createProvider("copilot", { apiKey: "x" })).toBeInstanceOf(CopilotAdapter);
  });

  it("classifies CLI auth + rate-limit failures from the error message", async () => {
    await expect(
      inject(new CopilotAdapter(cfg), fakeClient({ error: new Error("401 unauthorized") }).client).chat(req),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      inject(new CopilotAdapter(cfg), fakeClient({ error: new Error("rate limit exceeded") }).client).chat(req),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("invokeTool answers directly (the CLI never surfaces host tool_calls)", async () => {
    const res = await inject(new CopilotAdapter(cfg), fakeClient({ content: "done" }).client).invokeTool(req);
    expect(res.toolCalls).toEqual([]);
    expect(res.finishReason).toBe("stop");
    expect(res.text).toBe("done");
  });

  it("resumeTool folds prior tool results into the prompt", async () => {
    const f = fakeClient({ content: "It is 20C" });
    await inject(new CopilotAdapter(cfg), f.client).resumeTool(req, [
      { id: "call_1", name: "get_weather", content: "20C" },
    ]);
    const prompt = f.sendAndWait.mock.calls[0]![0].prompt;
    expect(prompt).toContain("[tool results]");
    expect(prompt).toContain("get_weather: 20C");
  });
});
