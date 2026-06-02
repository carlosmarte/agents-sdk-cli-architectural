# @llmorch-int/usecase-kit-adapter-local

**Pattern 1 — TS use-case kit** for a local / self-hosted or private LLM endpoint. Wraps `@llmorch/sdk` + the
`local` adapter and exposes idiomatic, typed helpers. No port logic is
duplicated — every call runs through the canonical orchestrator.

```ts
import { createLocalKit } from "@llmorch-int/usecase-kit-adapter-local";

const kit = createLocalKit(); // reads LLMORCH_LOCAL_API_KEY, default model llama3.2

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
pnpm --filter @llmorch-int/usecase-kit-adapter-local build
LLMORCH_LOCAL_API_KEY=... node dist/examples/run.js
```

## Offline mock examples (self-hosted + private Azure)

Two runnable demos exercise the **real** `local` adapter (openai client → HTTP)
against an in-process, dependency-free OpenAI-compatible mock server
(`src/mock/openai-mock-server.ts`) — no credentials, no network, no running model:

```sh
pnpm --filter @llmorch-int/usecase-kit-adapter-local build
node dist/examples/run-local-mock.js   # self-hosted (Ollama / LM Studio / vLLM …)
node dist/examples/run-azure-mock.js    # private Azure OpenAI deployment
```

- `run-local-mock.ts` points `baseUrl` at the mock; swap it for a real
  `http://localhost:11434/v1` and the code is unchanged.
- `run-azure-mock.ts` shows the Azure deltas the adapter handles via config
  (deployment URL, `api-key` header via `extraHeaders`, `api-version`) plus the
  401 → `AuthenticationError` mapping.

These files are hand-authored (not scaffold-generated). `test/mock-server.test.ts`
pins the mock + happy path in CI.
