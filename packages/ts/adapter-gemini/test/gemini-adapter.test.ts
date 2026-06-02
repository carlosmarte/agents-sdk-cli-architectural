import { beforeEach, describe, expect, it, vi } from "vitest";

const { genMock, chatsMock } = vi.hoisted(() => ({
  genMock: vi.fn(),
  chatsMock: vi.fn(),
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({
    models: { generateContent: genMock },
    chats: { create: chatsMock },
  })),
}));

import { AuthenticationError, RateLimitError, createProvider } from "@llmorch/core";

import { GeminiAdapter } from "../src/index.js";

const cfg = { provider: "gemini", apiKey: "k" } as never;
const stubRes = {
  text: "hi",
  usageMetadata: {
    promptTokenCount: 3,
    candidatesTokenCount: 2,
    totalTokenCount: 5,
  },
  candidates: [{ finishReason: "STOP" }],
};
const req = {
  model: "gemini-x",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
    { role: "assistant", content: "prev" },
  ],
  temperature: 0.3,
  maxTokens: 100,
  reasoningEffort: "medium",
} as never;

beforeEach(() => {
  genMock.mockReset();
  chatsMock.mockReset();
});

describe("GeminiAdapter", () => {
  it("nests all generation params inside config (none at top level)", async () => {
    genMock.mockResolvedValueOnce(stubRes);
    await new GeminiAdapter(cfg).chat(req);
    const args = genMock.mock.calls[0]![0] as Record<string, unknown>;
    const config = args.config as Record<string, unknown>;
    expect(config.temperature).toBe(0.3);
    expect(config.maxOutputTokens).toBe(100);
    expect(config.systemInstruction).toBe("sys");
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 8192 });
    expect(args.temperature).toBeUndefined();
    expect(args.maxOutputTokens).toBeUndefined();
  });

  it("uses the stateless generateContent path (chats.create not called)", async () => {
    genMock.mockResolvedValueOnce(stubRes);
    await new GeminiAdapter(cfg).chat(req);
    expect(genMock).toHaveBeenCalledTimes(1);
    expect(chatsMock).not.toHaveBeenCalled();
  });

  it("maps assistant role to 'model' in contents", async () => {
    genMock.mockResolvedValueOnce(stubRes);
    await new GeminiAdapter(cfg).chat(req);
    const contents = genMock.mock.calls[0]![0].contents as Array<{
      role: string;
    }>;
    expect(contents.map((c) => c.role)).toEqual(["user", "model"]);
  });

  it("extracts res.text + usageMetadata", async () => {
    genMock.mockResolvedValueOnce(stubRes);
    const res = await new GeminiAdapter(cfg).chat(req);
    expect(res.text).toBe("hi");
    expect(res.usage.promptTokens).toBe(3);
    expect(res.usage.completionTokens).toBe(2);
  });

  it("self-registers under 'gemini'", () => {
    expect(createProvider("gemini", { apiKey: "x" })).toBeInstanceOf(GeminiAdapter);
  });

  it("maps 401 → AuthenticationError and 429 → RateLimitError", async () => {
    genMock.mockRejectedValueOnce({ status: 401 });
    await expect(new GeminiAdapter(cfg).chat(req)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    genMock.mockRejectedValueOnce({ status: 429 });
    await expect(new GeminiAdapter(cfg).chat(req)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});
