import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CopilotAdapter } from "../src/index.js";

const cfg = { provider: "copilot", apiKey: "k" } as never;
const req = { model: "m", messages: [{ role: "user", content: "who?" }] } as never;
const Person = z.object({ name: z.string().min(2), age: z.number().int() });

function fakeClient(content: string) {
  const sendAndWait = vi.fn(async () => ({ data: { content } }));
  const createSession = vi.fn(async () => ({ sendAndWait, on: vi.fn(() => () => {}) }));
  return { client: { createSession, stop: vi.fn() }, sendAndWait };
}

function inject(adapter: CopilotAdapter, client: unknown): CopilotAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = client;
  return adapter;
}

describe("CopilotAdapter.generateStructured", () => {
  it("embeds the JSON Schema in the prompt and validates the parsed reply", async () => {
    const f = fakeClient(JSON.stringify({ name: "Ada", age: 36 }));
    const result = await inject(new CopilotAdapter(cfg), f.client).generateStructured(req, Person);
    expect(result).toEqual({ name: "Ada", age: 36 });
    expect(f.sendAndWait.mock.calls[0]![0].prompt).toContain("JSON Schema");
  });

  it("tolerates a fenced ```json block in the reply", async () => {
    const f = fakeClient("Here you go:\n```json\n{ \"name\": \"Ada\", \"age\": 36 }\n```\n");
    const result = await inject(new CopilotAdapter(cfg), f.client).generateStructured(req, Person);
    expect(result).toEqual({ name: "Ada", age: 36 });
  });
});
