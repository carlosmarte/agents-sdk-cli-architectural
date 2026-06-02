import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { LLMProvider } from "../../src/interface.js";
import { UnifiedResponseSchema } from "../../src/models/index.js";
import { FakeProvider } from "../../src/testing/index.js";

const req = {
  model: "fake-1",
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("LLMProvider contract — FakeProvider", () => {
  it("type-checks as an LLMProvider", () => {
    const p: LLMProvider = new FakeProvider();
    expect(p.providerId).toBe("fake");
  });

  it("chat returns a valid UnifiedResponse with finishReason 'stop'", async () => {
    const provider = new FakeProvider();
    const res = await provider.chat(req);
    expect(UnifiedResponseSchema.safeParse(res).success).toBe(true);
    expect(res.finishReason).toBe("stop");
  });

  it("stream yields >=1 chunk whose deltas concatenate to the chat text", async () => {
    const provider = new FakeProvider();
    const full = (await provider.chat(req)).text;
    let assembled = "";
    let chunkCount = 0;
    let sawFinish = false;
    for await (const chunk of provider.stream(req)) {
      assembled += chunk.delta;
      chunkCount += 1;
      if (chunk.finishReason) sawFinish = true;
    }
    expect(chunkCount).toBeGreaterThanOrEqual(1);
    expect(assembled).toBe(full);
    expect(sawFinish).toBe(true);
  });

  it("generateStructured returns a schema-valid object", async () => {
    const schema = z.object({ answer: z.string() });
    const provider = new FakeProvider({ structured: { answer: "42" } });
    const out = await provider.generateStructured(req, schema);
    expect(out.answer).toBe("42");
  });

  it("invokeTool returns a response with toolCalls and tool_use finish", async () => {
    const provider = new FakeProvider();
    const res = await provider.invokeTool({
      ...req,
      tools: [{ name: "lookup", description: "d", parameters: {} }],
    });
    expect(res.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(res.finishReason).toBe("tool_use");
  });

  it("drives the full halt→resume loop: invokeTool halts, resumeTool returns a stop response", async () => {
    const provider = new FakeProvider();
    const halt = await provider.invokeTool({
      ...req,
      tools: [{ name: "lookup", description: "d", parameters: {} }],
    });
    expect(halt.finishReason).toBe("tool_use");
    const call = halt.toolCalls[0]!;
    const resumed = await provider.resumeTool(req, [
      { id: call.id, name: call.name, content: "result-payload" },
    ]);
    expect(UnifiedResponseSchema.safeParse(resumed).success).toBe(true);
    expect(resumed.finishReason).toBe("stop");
    expect(resumed.text).toContain("result-payload");
  });
});
