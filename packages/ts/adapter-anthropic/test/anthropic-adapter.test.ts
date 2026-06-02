import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

import { AuthenticationError, RateLimitError, createProvider } from "@llmorch/core";

import { AnthropicAdapter } from "../src/index.js";

const cfg = { provider: "anthropic", apiKey: "k" } as never;
const stubRes = {
  content: [{ type: "text", text: "hi" }],
  usage: { input_tokens: 3, output_tokens: 2 },
  stop_reason: "end_turn",
};

const withSystem = {
  model: "claude-x",
  messages: [
    { role: "system", content: "be terse" },
    { role: "user", content: "hello" },
  ],
} as never;

beforeEach(() => createMock.mockReset());

describe("AnthropicAdapter", () => {
  it("extracts system and injects default max_tokens (1024)", async () => {
    createMock.mockResolvedValueOnce(stubRes);
    await new AnthropicAdapter(cfg).chat(withSystem);
    const args = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.system).toBe("be terse");
    expect(args.max_tokens).toBe(1024);
    const msgs = args.messages as Array<{ role: string }>;
    expect(msgs.every((m) => m.role !== "system")).toBe(true);
  });

  it("respects a caller-supplied maxTokens", async () => {
    createMock.mockResolvedValueOnce(stubRes);
    await new AnthropicAdapter(cfg).chat({ ...withSystem, maxTokens: 64 } as never);
    expect(createMock.mock.calls[0]![0].max_tokens).toBe(64);
  });

  it("wraps string content into a text block", async () => {
    createMock.mockResolvedValueOnce(stubRes);
    await new AnthropicAdapter(cfg).chat(withSystem);
    const msgs = createMock.mock.calls[0]![0].messages as Array<{
      content: unknown;
    }>;
    expect(msgs[0]!.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("attaches cache_control when caching is requested", async () => {
    createMock.mockResolvedValueOnce(stubRes);
    await new AnthropicAdapter(cfg).chat({ ...withSystem, cacheControl: true } as never);
    const system = createMock.mock.calls[0]![0].system as Array<
      Record<string, unknown>
    >;
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("maps content[0].text + usage into a UnifiedResponse", async () => {
    createMock.mockResolvedValueOnce(stubRes);
    const res = await new AnthropicAdapter(cfg).chat(withSystem);
    expect(res.text).toBe("hi");
    expect(res.usage.promptTokens).toBe(3);
    expect(res.usage.completionTokens).toBe(2);
  });

  it("self-registers under 'anthropic'", () => {
    expect(createProvider("anthropic", { apiKey: "x" })).toBeInstanceOf(
      AnthropicAdapter,
    );
  });

  it("maps 401 → AuthenticationError and 429 → RateLimitError", async () => {
    createMock.mockRejectedValueOnce({ status: 401 });
    await expect(new AnthropicAdapter(cfg).chat(withSystem)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    createMock.mockRejectedValueOnce({ status: 429 });
    await expect(new AnthropicAdapter(cfg).chat(withSystem)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});
