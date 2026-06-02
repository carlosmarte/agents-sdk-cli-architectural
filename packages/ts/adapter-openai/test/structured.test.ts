import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OpenAIAdapter } from "../src/index.js";

const cfg = { provider: "openai", apiKey: "k" } as never;
const req = { model: "m", messages: [{ role: "user", content: "who?" }] } as never;
const Person = z.object({ name: z.string().min(2), age: z.number().int() });

function inject(adapter: OpenAIAdapter, create: unknown): OpenAIAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = {
    chat: { completions: { create } },
  };
  return adapter;
}

describe("OpenAIAdapter.generateStructured", () => {
  it("returns an object that validates against the original Zod schema", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: "Ada", age: 36 }) } }],
    });
    const result = await inject(new OpenAIAdapter(cfg), create).generateStructured(
      req,
      Person,
    );
    expect(result).toEqual({ name: "Ada", age: 36 });
    expect(() => Person.parse(result)).not.toThrow();
  });

  it("sends a strict json_schema response_format", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: "Ada", age: 36 }) } }],
    });
    await inject(new OpenAIAdapter(cfg), create).generateStructured(req, Person);
    const rf = create.mock.calls[0]![0].response_format;
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema.type).toBe("object");
  });

  it("raises when the returned JSON violates the schema", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: "A", age: 36 }) } }],
    });
    await expect(
      inject(new OpenAIAdapter(cfg), create).generateStructured(req, Person),
    ).rejects.toThrow();
  });
});
