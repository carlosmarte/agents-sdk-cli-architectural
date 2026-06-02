import { describe, expect, it, vi } from "vitest";

import type { ChatRequest, ToolDefinition } from "../src/models/index.js";

import { AnthropicAdapter } from "../../adapter-anthropic/src/index.js";
import { CopilotAdapter } from "../../adapter-copilot/src/index.js";
import { GeminiAdapter } from "../../adapter-gemini/src/index.js";
import { OpenAIAdapter } from "../../adapter-openai/src/index.js";

const weather: ToolDefinition = {
  name: "get_weather",
  description: "Get the weather for a city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

const cfg = { provider: "x", apiKey: "k" } as never;
const req: ChatRequest = {
  model: "m",
  messages: [{ role: "user", content: "weather in Paris?" }],
  tools: [weather],
  toolChoice: { type: "tool", name: "get_weather" },
};

function setClient<A>(adapter: A, client: unknown): A {
  (adapter as unknown as { cachedClient: unknown }).cachedClient = client;
  return adapter;
}

// ─── OpenAI / Copilot (identical OpenAI-compatible wire shape) ──────────────────
const openAiToolCall = {
  choices: [
    {
      message: {
        tool_calls: [
          {
            id: "call_1",
            function: { name: "get_weather", arguments: JSON.stringify({ city: "Paris" }) },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
};
const openAiFinal = {
  choices: [{ message: { content: "It is 20C in Paris." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 6 },
};

function openAiClient() {
  const create = vi
    .fn()
    .mockResolvedValueOnce(openAiToolCall)
    .mockResolvedValueOnce(openAiFinal);
  return { client: { chat: { completions: { create } } }, create };
}

describe("openai tool loop (OpenAI-compatible)", () => {
  it("halts on the tool call then resumes to a final answer", async () => {
    const { client, create } = openAiClient();
    const adapter = setClient(new OpenAIAdapter(cfg), client);

    const halt = await adapter.invokeTool(req);
    expect(halt.finishReason).toBe("tool_use");
    expect(halt.toolCalls).toEqual([
      { id: "call_1", name: "get_weather", arguments: { city: "Paris" } },
    ]);
    expect(create).toHaveBeenCalledTimes(1); // no auto-execution / auto-resume

    // Translation shape: a function-tool array.
    const tools = create.mock.calls[0]![0].tools;
    expect(tools[0]).toMatchObject({ type: "function", function: { name: "get_weather" } });

    const final = await adapter.resumeTool(req, [
      { id: "call_1", name: "get_weather", content: "20C" },
    ]);
    expect(final.text).toBe("It is 20C in Paris.");
    // The resume turn appends a `tool` message keyed by the call **id**, not the name.
    const resumeMsgs = create.mock.calls[1]![0].messages;
    expect(resumeMsgs.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call_1",
      content: "20C",
    });
  });
});

// ─── Copilot (agentic CLI — no host-side tool dispatch) ─────────────────────────
function copilotClient(content: string) {
  const sendAndWait = vi.fn(async () => ({ data: { content } }));
  const createSession = vi.fn(async () => ({ sendAndWait, on: vi.fn(() => () => {}) }));
  return { client: { createSession, stop: vi.fn() }, sendAndWait };
}

describe("copilot tool loop", () => {
  it("answers directly without surfacing host tool_calls", async () => {
    const adapter = setClient(new CopilotAdapter(cfg), copilotClient("It is 20C in Paris.").client);
    const res = await adapter.invokeTool(req);
    // The Copilot CLI dispatches its own tools, so there is no tool_use halt.
    expect(res.finishReason).toBe("stop");
    expect(res.toolCalls).toEqual([]);
    expect(res.text).toBe("It is 20C in Paris.");
  });

  it("resumeTool folds prior tool results into the prompt", async () => {
    const cp = copilotClient("done");
    const adapter = setClient(new CopilotAdapter(cfg), cp.client);
    const res = await adapter.resumeTool(req, [
      { id: "call_1", name: "get_weather", content: "20C" },
    ]);
    expect(res.text).toBe("done");
    expect(cp.sendAndWait.mock.calls[0]![0].prompt).toContain("get_weather: 20C");
  });
});

// ─── Anthropic ─────────────────────────────────────────────────────────────────
describe("anthropic tool loop", () => {
  it("halts with a tool_use block then resumes via a tool_result block", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "It is 20C in Paris." }],
        stop_reason: "end_turn",
      });
    const adapter = setClient(new AnthropicAdapter(cfg), { messages: { create } });

    const halt = await adapter.invokeTool(req);
    expect(halt.finishReason).toBe("tool_use");
    expect(halt.toolCalls).toEqual([
      { id: "toolu_1", name: "get_weather", arguments: { city: "Paris" } },
    ]);

    const args = create.mock.calls[0]![0];
    expect(args.tools[0].input_schema.type).toBe("object");
    expect(args.tool_choice).toEqual({ type: "tool", name: "get_weather" });

    const final = await adapter.resumeTool(req, [
      { id: "toolu_1", name: "get_weather", content: "20C" },
    ]);
    expect(final.text).toBe("It is 20C in Paris.");
    const resumeMsg = create.mock.calls[1]![0].messages.at(-1);
    expect(resumeMsg.role).toBe("user");
    // Anthropic keys the resume by the call **id**, not the name.
    expect(resumeMsg.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: "20C",
    });
  });
});

// ─── Gemini (automatic function calling disabled) ───────────────────────────────
describe("gemini tool loop", () => {
  it("disables auto function-calling, halts, then resumes via functionResponse", async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({
        candidates: [
          { content: { parts: [{ functionCall: { name: "get_weather", args: { city: "Paris" } } }] } },
        ],
      })
      .mockResolvedValueOnce({
        text: "It is 20C in Paris.",
        candidates: [{ finishReason: "STOP" }],
      });
    const chats = { create: vi.fn() };
    const adapter = setClient(new GeminiAdapter(cfg), {
      models: { generateContent },
      chats,
    });

    const halt = await adapter.invokeTool(req);
    expect(halt.finishReason).toBe("tool_use");
    expect(halt.toolCalls[0]).toMatchObject({
      name: "get_weather",
      arguments: { city: "Paris" },
    });

    const config = generateContent.mock.calls[0]![0].config;
    expect(config.tools[0].functionDeclarations[0].name).toBe("get_weather");
    // Automatic / client-side function-calling is turned OFF (mode "NONE").
    expect(config.toolConfig.functionCallingConfig.mode).toBe("NONE");
    expect(config.automaticFunctionCalling.disable).toBe(true);
    expect(chats.create).not.toHaveBeenCalled();

    // id ≠ name on purpose: Gemini must key the functionResponse by **name**.
    const final = await adapter.resumeTool(req, [
      { id: "call_1", name: "get_weather", content: "20C" },
    ]);
    expect(final.text).toBe("It is 20C in Paris.");
    const resumeParts = generateContent.mock.calls[1]![0].contents.at(-1).parts;
    expect(resumeParts[0].functionResponse.name).toBe("get_weather");
  });
});
