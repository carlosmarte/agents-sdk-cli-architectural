/**
 * Runnable demo: drive a *local / self-hosted* LLM through the use-case kit —
 * entirely offline, against an in-process OpenAI-compatible mock server.
 *
 *   pnpm --filter @llmorch-int/usecase-kit-adapter-local build
 *   node dist/examples/run-local-mock.js
 *
 * No credentials, no network, no running Ollama needed. In production you'd drop
 * the mock and point `baseUrl` at your real endpoint — e.g.
 *   createLocalKit({ baseUrl: "http://localhost:11434/v1" })   // Ollama
 *   createLocalKit({ baseUrl: "http://localhost:1234/v1" })    // LM Studio
 * — everything below stays identical.
 */
import { z } from "zod";

import { createLocalKit } from "../index.js";
import { startMockServer } from "../mock/openai-mock-server.js";

async function main(): Promise<void> {
  const mock = await startMockServer();
  console.log(`mock self-hosted endpoint listening at ${mock.url}\n`);

  try {
    // Point the kit at the mock instead of the default Ollama endpoint.
    const kit = createLocalKit({ baseUrl: mock.url, model: "llama3.2" });

    // 1) one-shot chat
    console.log("ask     :", await kit.ask("Say hello in exactly five words."));

    // 2) streaming
    process.stdout.write("stream  : ");
    for await (const delta of kit.stream("Count from 1 to 5.")) {
      process.stdout.write(delta);
    }
    process.stdout.write("\n");

    // 3) structured output — the mock honors the JSON Schema the adapter sends
    const Person = z.object({ name: z.string(), age: z.number().int() });
    console.log("extract :", await kit.extract("Invent a person as JSON.", Person));

    // 4) tool calling (single-round halt -> run handler -> resume)
    const tools = [
      {
        name: "get_weather",
        description: "Get the current weather for a city.",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];
    const answer = await kit.runTools("What is the weather in Paris?", tools, {
      get_weather: (args) => `It is 21C and sunny in ${String(args.city)}.`,
    });
    console.log("runTools:", answer.text);
  } finally {
    await mock.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
