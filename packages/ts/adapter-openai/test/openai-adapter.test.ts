import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", () => ({
  default: vi.fn(() => ({ chat: { completions: { create: createMock } } })),
}));

import { AuthenticationError, RateLimitError, createProvider } from "@llmorch/core";

import { OpenAIAdapter } from "../src/index.js";

const cfg = { provider: "openai", apiKey: "k" } as never;
const req = {
  model: "gpt-x",
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.5,
  maxTokens: 256,
} as never;
const stubRes = {
  choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
};

beforeEach(() => createMock.mockReset());

describe("OpenAIAdapter", () => {
  it("maps a ChatRequest to chat.completions.create args", async () => {
    createMock.mockResolvedValueOnce(stubRes);
    await new OpenAIAdapter(cfg).chat(req);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-x", temperature: 0.5, max_tokens: 256 }),
    );
  });

  it("extracts text + usage into a UnifiedResponse", async () => {
    createMock.mockResolvedValueOnce(stubRes);
    const res = await new OpenAIAdapter(cfg).chat(req);
    expect(res.text).toBe("hello");
    expect(res.usage.promptTokens).toBe(3);
    expect(res.usage.completionTokens).toBe(4);
    expect(res.finishReason).toBe("stop");
  });

  it("self-registers under 'openai'", () => {
    expect(createProvider("openai", { apiKey: "x" })).toBeInstanceOf(OpenAIAdapter);
  });

  it("maps 401 → AuthenticationError and 429 → RateLimitError", async () => {
    createMock.mockRejectedValueOnce({ status: 401 });
    await expect(new OpenAIAdapter(cfg).chat(req)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    createMock.mockRejectedValueOnce({ status: 429 });
    await expect(new OpenAIAdapter(cfg).chat(req)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});
