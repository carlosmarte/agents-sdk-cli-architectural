import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GeminiAdapter } from "../src/index.js";

const cfg = { provider: "gemini", apiKey: "k" } as never;
const req = { model: "m", messages: [{ role: "user", content: "who?" }] } as never;
const Person = z.object({ name: z.string().min(2), age: z.number().int() });

function inject(adapter: GeminiAdapter, generateContent: unknown): GeminiAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = {
    models: { generateContent },
    chats: { create: vi.fn() },
  };
  return adapter;
}

describe("GeminiAdapter.generateStructured", () => {
  it("sets responseMimeType + responseSchema and returns the validated object", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({ name: "Ada", age: 36 }),
    });
    const result = await inject(new GeminiAdapter(cfg), generateContent).generateStructured(
      req,
      Person,
    );
    expect(result).toEqual({ name: "Ada", age: 36 });

    const config = generateContent.mock.calls[0]![0].config;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema.type).toBe("object");
  });
});
