import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ChatRequest, Orchestrator, ToolResult } from "@llmorch/core";

import { DEFAULT_MODEL, PROVIDER_ID, createAnthropicKit } from "../src/index.js";

interface Recorder {
  orch: Orchestrator;
  reqs: ChatRequest[];
}

/** A scriptable in-memory orchestrator that records the requests the kit builds. */
function fakeOrchestrator(): Recorder {
  const reqs: ChatRequest[] = [];
  const usage = { promptTokens: 1, completionTokens: 1 };
  const orch: Orchestrator = {
    async chat(req) {
      reqs.push(req);
      return { text: "ok", usage, toolCalls: [], finishReason: "stop" };
    },
    async *stream(req) {
      reqs.push(req);
      yield { delta: "he" };
      yield { delta: "llo" };
      yield { delta: "", usage, finishReason: "stop" };
    },
    async generateStructured(req, schema) {
      reqs.push(req);
      return schema.parse({ name: "Ada", age: 36 });
    },
    async invokeTool(req) {
      reqs.push(req);
      return {
        text: "",
        usage,
        toolCalls: [{ id: "c1", name: "get_weather", arguments: { city: "Paris" } }],
        finishReason: "tool_use",
      };
    },
    async resumeTool(req, results: ToolResult[]) {
      reqs.push(req);
      return {
        text: `done:${results.map((r) => r.content).join(",")}`,
        usage,
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
  return { orch, reqs };
}

describe("usecase-kit-adapter-anthropic", () => {
  it("targets the anthropic provider and default model", () => {
    const { orch } = fakeOrchestrator();
    const kit = createAnthropicKit({ orchestrator: orch });
    expect(kit.provider).toBe(PROVIDER_ID);
    expect(kit.model).toBe(DEFAULT_MODEL);
  });

  it("ask() returns assistant text and threads the system prompt", async () => {
    const { orch, reqs } = fakeOrchestrator();
    const kit = createAnthropicKit({ orchestrator: orch });
    const out = await kit.ask("hi", { system: "be terse" });
    expect(out).toBe("ok");
    expect(reqs[0]!.messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(reqs[0]!.model).toBe(DEFAULT_MODEL);
  });

  it("stream() yields only non-empty text deltas", async () => {
    const { orch } = fakeOrchestrator();
    const kit = createAnthropicKit({ orchestrator: orch });
    const seen: string[] = [];
    for await (const d of kit.stream("go")) seen.push(d);
    expect(seen).toEqual(["he", "llo"]);
  });

  it("extract() validates structured output against the schema", async () => {
    const { orch } = fakeOrchestrator();
    const kit = createAnthropicKit({ orchestrator: orch });
    const person = await kit.extract(
      "x",
      z.object({ name: z.string(), age: z.number() }),
    );
    expect(person).toEqual({ name: "Ada", age: 36 });
  });

  it("runTools() runs the handler and resumes to a final answer", async () => {
    const { orch } = fakeOrchestrator();
    const kit = createAnthropicKit({ orchestrator: orch });
    const res = await kit.runTools(
      "weather?",
      [{ name: "get_weather", description: "w", parameters: { type: "object" } }],
      { get_weather: (args) => `sunny in ${String(args.city)}` },
    );
    expect(res.text).toBe("done:sunny in Paris");
  });
});
