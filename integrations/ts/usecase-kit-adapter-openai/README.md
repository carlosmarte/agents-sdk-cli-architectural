# @llmorch-int/usecase-kit-adapter-openai

**Pattern 1 — TS use-case kit** for OpenAI. Wraps `@llmorch/sdk` + the
`openai` adapter and exposes idiomatic, typed helpers. No port logic is
duplicated — every call runs through the canonical orchestrator.

```ts
import { createOpenAIKit } from "@llmorch-int/usecase-kit-adapter-openai";

const kit = createOpenAIKit(); // reads OPENAI_API_KEY, default model gpt-4o-mini

await kit.ask("Summarize hexagonal architecture in one line.");
for await (const delta of kit.stream("Count to 5")) process.stdout.write(delta);
```

## Surface

- `ask(prompt, opts?)` → assistant text
- `chat(messages, opts?)` → `UnifiedResponse`
- `stream(prompt, opts?)` → `AsyncGenerator<string>`
- `extract(prompt, zodSchema, opts?)` → value validated against the schema
- `runTools(prompt, tools, handlers, opts?)` → final `UnifiedResponse`

Options: `apiKey`, `model`, `baseUrl`, `temperature`, `maxTokens`, `telemetry`,
`fallback` (extra providers, ordered), `orchestrator` (inject your own).

## Run the demo

```sh
pnpm --filter @llmorch-int/usecase-kit-adapter-openai build
OPENAI_API_KEY=... node dist/examples/run.js
```
