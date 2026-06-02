/**
 * Runnable demo for @llmorch-int/usecase-kit-adapter-anthropic.
 *
 *   pnpm --filter @llmorch-int/usecase-kit-adapter-anthropic build
 *   ANTHROPIC_API_KEY=... node dist/examples/run.js
 *
 * Exits early with a hint if ANTHROPIC_API_KEY is unset, so it is safe to invoke in CI.
 */
import { z } from "zod";

import { API_KEY_ENV, DEFAULT_MODEL, createAnthropicKit } from "../index.js";

async function main(): Promise<void> {
  if (!process.env[API_KEY_ENV]) {
    console.log(`Set ${API_KEY_ENV} to run this demo (default model: ${DEFAULT_MODEL}).`);
    return;
  }

  const kit = createAnthropicKit();

  // 1) one-shot chat
  console.log("ask     :", await kit.ask("Say hello in exactly five words."));

  // 2) streaming
  process.stdout.write("stream  : ");
  for await (const delta of kit.stream("Count from 1 to 5.")) {
    process.stdout.write(delta);
  }
  process.stdout.write("\n");

  // 3) structured output (validated against a Zod schema)
  const Person = z.object({ name: z.string(), age: z.number().int() });
  console.log("extract :", await kit.extract("Invent a person as JSON.", Person));

  // 4) tool calling (single-round halt -> resume)
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
  // resumeTool support varies by provider (the normalized message model can't
  // carry an assistant tool-call turn), so degrade gracefully rather than crash.
  try {
    const answer = await kit.runTools("What is the weather in Paris?", tools, {
      get_weather: (args) => `It is 21C and sunny in ${String(args.city)}.`,
    });
    console.log("runTools:", answer.text);
  } catch (err) {
    console.log("runTools: skipped —", err instanceof Error ? err.message : String(err));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
