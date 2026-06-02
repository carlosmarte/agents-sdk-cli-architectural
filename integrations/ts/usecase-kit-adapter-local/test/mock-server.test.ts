import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { AuthenticationError } from "@llmorch/core";
import { createOrchestrator } from "@llmorch/sdk";

import { createLocalKit } from "../src/index.js";
import { startMockServer, type MockServer } from "../src/mock/openai-mock-server.js";

// These tests drive the REAL `local` adapter (openai client → HTTP) against the
// in-process mock, so they validate the full wire path the examples rely on —
// not a fake orchestrator. This is what makes the example scripts trustworthy.

describe("usecase-kit-adapter-local against the OpenAI-compatible mock (self-hosted)", () => {
  let mock: MockServer;
  beforeAll(async () => {
    mock = await startMockServer();
  });
  afterAll(async () => {
    await mock.close();
  });

  it("ask() returns text from the mock endpoint", async () => {
    const kit = createLocalKit({ baseUrl: mock.url });
    const out = await kit.ask("hello");
    expect(out).toContain("mock");
  });

  it("stream() yields decoded SSE deltas", async () => {
    const kit = createLocalKit({ baseUrl: mock.url });
    const seen: string[] = [];
    for await (const d of kit.stream("count")) seen.push(d);
    expect(seen.join("")).toContain("streaming");
  });

  it("extract() validates schema-conforming structured output", async () => {
    const kit = createLocalKit({ baseUrl: mock.url });
    const Person = z.object({ name: z.string(), age: z.number().int() });
    const person = await kit.extract("invent a person", Person);
    expect(typeof person.name).toBe("string");
    expect(Number.isInteger(person.age)).toBe(true);
  });

  it("runTools() completes the halt -> handler -> resume loop", async () => {
    const kit = createLocalKit({ baseUrl: mock.url });
    const res = await kit.runTools(
      "weather in Paris?",
      [
        {
          name: "get_weather",
          description: "weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
      { get_weather: (args) => `sunny in ${String(args.city)}` },
    );
    expect(res.text).toContain("sunny in Paris");
  });
});

describe("private Azure deployment via the `local` adapter", () => {
  let mock: MockServer;
  const KEY = "azure-secret-key";
  beforeAll(async () => {
    mock = await startMockServer({ requireApiKey: KEY });
  });
  afterAll(async () => {
    await mock.close();
  });

  const cfg = (apiKey: string) => ({
    provider: "local" as const,
    apiKey,
    baseUrl: `${mock.url}/openai/deployments/gpt-4o`,
    defaultModel: "gpt-4o",
    extraHeaders: { "api-key": apiKey },
  });

  it("succeeds when the api-key header matches", async () => {
    const kit = createLocalKit({ orchestrator: createOrchestrator([cfg(KEY)]) });
    expect(await kit.ask("hi")).toContain("mock");
  });

  it("maps a wrong api-key to a non-retriable AuthenticationError", async () => {
    const kit = createLocalKit({ orchestrator: createOrchestrator([cfg("wrong")]) });
    await expect(kit.ask("hi")).rejects.toBeInstanceOf(AuthenticationError);
  });
});
