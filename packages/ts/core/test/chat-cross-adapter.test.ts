import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRequest } from "../src/models/index.js";
import { createOrchestrator } from "../src/orchestrator.js";
import { registerProvider } from "../src/factory.js";
import { FakeProvider } from "./fixtures/fake-provider.js";

import { AnthropicAdapter } from "../../adapter-anthropic/src/index.js";
import { CopilotAdapter } from "../../adapter-copilot/src/index.js";
import { GeminiAdapter } from "../../adapter-gemini/src/index.js";
import { OpenAIAdapter } from "../../adapter-openai/src/index.js";

/**
 * Adapters construct their provider SDK lazily via a private `cachedClient`. We
 * inject a recording fake directly rather than mocking the SDK module — each
 * adapter resolves its SDK from its own nested `node_modules`, so a module mock
 * declared here would not intercept it. Injection is exact and resolution-proof.
 */
function inject<A>(adapter: A, client: unknown): A {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = client;
  return adapter;
}

const cfg = { provider: "x", apiKey: "k" } as never;

const openaiRes = {
  choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 4 },
};
const anthropicRes = {
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 3, output_tokens: 4 },
  stop_reason: "end_turn",
};
const geminiRes = {
  text: "ok",
  usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
  candidates: [{ finishReason: "STOP" }],
};

function openAiClient() {
  return { chat: { completions: { create: vi.fn().mockResolvedValue(openaiRes) } } };
}
function anthropicClient() {
  return { messages: { create: vi.fn().mockResolvedValue(anthropicRes) } };
}
function geminiClient() {
  return {
    models: { generateContent: vi.fn().mockResolvedValue(geminiRes) },
    chats: { create: vi.fn() }, // a spy we assert is NEVER called
  };
}
/** Copilot drives the agentic CLI: one session per call, `sendAndWait` per prompt. */
function copilotClient(content = "ok") {
  const sendAndWait = vi.fn(async () => ({ data: { content } }));
  const createSession = vi.fn(async () => ({ sendAndWait, on: vi.fn(() => () => {}) }));
  return { client: { createSession, stop: vi.fn() }, sendAndWait };
}

/** A four-turn conversation including a system turn. */
const history: ChatRequest = {
  model: "m",
  messages: [
    { role: "system", content: "be terse" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "again" },
  ],
};

describe("stateless chat — full-history serialization", () => {
  it("serializes the entire message history every turn (nothing dropped)", async () => {
    const oa = openAiClient();
    const cp = copilotClient();
    const an = anthropicClient();
    const ge = geminiClient();
    await inject(new OpenAIAdapter(cfg), oa).chat(history);
    await inject(new CopilotAdapter(cfg), cp.client).chat(history);
    await inject(new AnthropicAdapter(cfg), an).chat(history);
    await inject(new GeminiAdapter(cfg), ge).chat(history);

    // OpenAI passes the full history as messages (system kept inline).
    expect(oa.chat.completions.create.mock.calls[0]![0].messages).toHaveLength(4);
    // Copilot flattens the full history into one CLI prompt (nothing dropped).
    const cpPrompt = cp.sendAndWait.mock.calls[0]![0].prompt;
    for (const turn of ["be terse", "hi", "hello", "again"]) {
      expect(cpPrompt).toContain(turn);
    }

    // Anthropic hoists the system turn into `system`; the other 3 remain.
    const anArgs = an.messages.create.mock.calls[0]![0];
    expect(anArgs.messages).toHaveLength(3);
    expect(anArgs.system).toBe("be terse");

    // Gemini hoists system into `config.systemInstruction`; 3 contents remain.
    const geArgs = ge.models.generateContent.mock.calls[0]![0];
    expect(geArgs.contents).toHaveLength(3);
    expect(geArgs.config.systemInstruction).toBe("be terse");
  });

  it("holds no hidden state — turn 2 carries only turn 2's messages", async () => {
    const oa = openAiClient();
    const adapter = inject(new OpenAIAdapter(cfg), oa);
    await adapter.chat({ model: "m", messages: [{ role: "user", content: "first" }] });
    await adapter.chat({ model: "m", messages: [{ role: "user", content: "second" }] });
    const second = oa.chat.completions.create.mock.calls[1]![0].messages;
    expect(second).toHaveLength(1);
    expect(second[0].content).toBe("second");
  });

  it("uses Gemini's stateless generateContent — chats.create is never called", async () => {
    const ge = geminiClient();
    await inject(new GeminiAdapter(cfg), ge).chat(history);
    expect(ge.models.generateContent).toHaveBeenCalledTimes(1);
    expect(ge.chats.create).not.toHaveBeenCalled();
  });
});

describe("identical normalized response shape across adapters", () => {
  it("every adapter returns the same UnifiedResponse keys + values", async () => {
    const oa = await inject(new OpenAIAdapter(cfg), openAiClient()).chat(history);
    const cp = await inject(new CopilotAdapter(cfg), copilotClient().client).chat(history);
    const an = await inject(new AnthropicAdapter(cfg), anthropicClient()).chat(history);
    const ge = await inject(new GeminiAdapter(cfg), geminiClient()).chat(history);

    for (const res of [oa, cp, an, ge]) {
      expect(Object.keys(res).sort()).toEqual(
        ["finishReason", "text", "toolCalls", "usage"].sort(),
      );
      expect(Object.keys(res.usage).sort()).toEqual(
        ["completionTokens", "promptTokens"].sort(),
      );
      expect(res.text).toBe("ok");
      expect(res.toolCalls).toEqual([]);
      expect(res.finishReason).toBe("stop");
    }
    // The REST adapters surface provider token usage; the Copilot CLI SDK
    // reports none, so its usage is normalized to zero.
    for (const res of [oa, an, ge]) {
      expect(res.usage.promptTokens).toBe(3);
      expect(res.usage.completionTokens).toBe(4);
    }
    expect(cp.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});

describe("orchestrator chat passthrough", () => {
  beforeEach(() => registerProvider("openai", FakeProvider));

  it("delegates to the resolved provider and fires telemetry once", async () => {
    const onRequestStart = vi.fn();
    const onRequestEnd = vi.fn();
    const orch = createOrchestrator(
      { provider: "openai", apiKey: "k" },
      { telemetry: { onRequestStart, onRequestEnd } },
    );
    const res = await orch.chat(history);
    // FakeProvider returns its canned response unchanged (passthrough — no mutation).
    expect(res.text).toBe("chat:openai");
    expect(onRequestStart).toHaveBeenCalledTimes(1);
    expect(onRequestStart).toHaveBeenCalledWith(
      expect.objectContaining({ method: "chat", providerId: "openai" }),
    );
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
  });
});
