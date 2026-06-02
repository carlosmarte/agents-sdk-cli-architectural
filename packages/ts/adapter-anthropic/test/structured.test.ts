import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { SchemaValidationError } from "@llmorch/core";

import { AnthropicAdapter } from "../src/index.js";

const cfg = { provider: "anthropic", apiKey: "k" } as never;
const req = { model: "m", messages: [{ role: "user", content: "who?" }] } as never;
const Person = z.object({ name: z.string().min(2), age: z.number().int() });

function inject(adapter: AnthropicAdapter, create: unknown): AnthropicAdapter {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = {
    messages: { create },
  };
  return adapter;
}

describe("AnthropicAdapter.generateStructured", () => {
  it("uses forced tool_use and returns the validated object", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "result", input: { name: "Ada", age: 36 } }],
    });
    const result = await inject(new AnthropicAdapter(cfg), create).generateStructured(
      req,
      Person,
    );
    expect(result).toEqual({ name: "Ada", age: 36 });

    const args = create.mock.calls[0]![0];
    expect(args.tool_choice).toEqual({ type: "tool", name: "result" });
    expect(args.tools[0].input_schema.type).toBe("object");
  });

  it("enforces the ORIGINAL schema locally even though Anthropic strips constraints", async () => {
    // Anthropic drops minLength; "A" (len 1) violates min(2) and must still fail.
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "result", input: { name: "A", age: 36 } }],
    });
    await expect(
      inject(new AnthropicAdapter(cfg), create).generateStructured(req, Person),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it("does not mutate the tool description between calls (stable grammar cache)", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "result", input: { name: "Ada", age: 36 } }],
    });
    const adapter = inject(new AnthropicAdapter(cfg), create);
    await adapter.generateStructured(req, Person);
    await adapter.generateStructured(req, Person);
    expect(create.mock.calls[0]![0].tools[0].description).toBe(
      create.mock.calls[1]![0].tools[0].description,
    );
  });
});
