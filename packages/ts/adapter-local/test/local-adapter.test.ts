import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AuthenticationError, ProviderError, createProvider } from "@llmorch/core";

import { DEFAULT_LOCAL_BASE_URL, LocalAdapter } from "../src/index.js";

const cfg = { provider: "local", apiKey: undefined } as never;
const req = {
  model: "llama3.2",
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.5,
  maxTokens: 256,
} as never;

/** Build an adapter with an injected fake client (no module-mock, no network). */
function withClient(create: ReturnType<typeof vi.fn>, config = cfg) {
  const adapter = new LocalAdapter(config);
  (adapter as unknown as { cachedClient: unknown }).cachedClient = {
    chat: { completions: { create } },
  };
  return adapter;
}

describe("LocalAdapter", () => {
  it("self-registers under 'local'", () => {
    expect(createProvider("local", {})).toBeInstanceOf(LocalAdapter);
  });

  it("defaults baseUrl to the Ollama OpenAI-compatible path when none given", () => {
    const adapter = new LocalAdapter(cfg);
    expect((adapter as unknown as { baseUrl: string }).baseUrl).toBe(
      DEFAULT_LOCAL_BASE_URL,
    );
  });

  it("honors an explicit baseUrl", () => {
    const adapter = new LocalAdapter({
      provider: "local",
      baseUrl: "http://localhost:1234/v1",
    } as never);
    expect((adapter as unknown as { baseUrl: string }).baseUrl).toBe(
      "http://localhost:1234/v1",
    );
  });

  it("maps a chat completion into a UnifiedResponse", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content: "hey" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    });
    const res = await withClient(create).chat(req);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "llama3.2", temperature: 0.5, max_tokens: 256 }),
    );
    expect(res).toEqual({
      text: "hey",
      usage: { promptTokens: 3, completionTokens: 4 },
      toolCalls: [],
      finishReason: "stop",
    });
  });

  it("structured: steers via json_object + validates against the original schema", async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content: '{"name":"Ada","age":36}' } }],
    });
    const out = await withClient(create).generateStructured(req, schema);
    expect(out).toEqual({ name: "Ada", age: 36 });
    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.response_format).toEqual({ type: "json_object" });
    expect((params.messages as Array<{ role: string }>)[0]!.role).toBe("system");
  });

  it("maps 401 → AuthenticationError", async () => {
    const create = vi.fn().mockRejectedValueOnce({ status: 401 });
    await expect(withClient(create).chat(req)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps a connection refusal to a retriable ProviderError naming the endpoint", async () => {
    const create = vi.fn().mockRejectedValueOnce({ code: "ECONNREFUSED" });
    const err = await withClient(create)
      .chat(req)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retriable).toBe(true);
    expect((err as Error).message).toContain(DEFAULT_LOCAL_BASE_URL);
  });
});
