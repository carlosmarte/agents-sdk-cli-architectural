# llmorch TS integrations

Provider integrations for the llmorch SDK, focused on **TypeScript use cases**.
Three integration *patterns* are offered for each of the five providers, so a
consuming app can pick the level of abstraction it wants. Every package is a
member of the `packages/ts` pnpm workspace (wired via the `../../integrations/ts/*`
glob) and depends on the canonical `@llmorch/*` packages by `workspace:*`.

## The 3 × 5 matrix

| Provider  | Pattern 1 — use-case kit            | Pattern 2 — standalone adapter        | Pattern 3 — re-export wrapper        |
| --------- | ----------------------------------- | ------------------------------------- | ------------------------------------ |
| OpenAI    | `usecase-kit-adapter-openai`        | `standalone-adapter-openai`           | `reexport-adapter-openai`            |
| Anthropic | `usecase-kit-adapter-anthropic`     | `standalone-adapter-anthropic`        | `reexport-adapter-anthropic`         |
| Gemini    | `usecase-kit-adapter-gemini`        | `standalone-adapter-gemini`           | `reexport-adapter-gemini`            |
| Copilot   | `usecase-kit-adapter-copilot`       | `standalone-adapter-copilot`          | `reexport-adapter-copilot`           |
| Local     | `usecase-kit-adapter-local`         | `standalone-adapter-local`            | `reexport-adapter-local`             |

> **Local** is the bring-your-own-endpoint provider: it speaks the OpenAI wire
> protocol against a configurable `baseUrl`, so a self-hosted server (Ollama / LM
> Studio / vLLM / llama.cpp / LocalAI) **or a private Azure OpenAI deployment**
> flows through the same orchestrator/resilience/telemetry/tools pipeline as the
> hosted providers. Its use-case kit ships **runnable, offline example mocks** —
> see [Mock examples](#mock-examples-local--private-azure) below.

npm names follow `@llmorch-int/<dir>` (e.g. `@llmorch-int/usecase-kit-adapter-openai`).

## Which pattern?

- **Pattern 1 — TS use-case kit** (`@llmorch/sdk` + typed helpers). The highest
  level. `create<Provider>Kit()` returns `ask` / `chat` / `stream` / `extract` /
  `runTools`, plus runnable examples under `src/examples/run.ts`. No port logic
  is duplicated — calls run through the canonical orchestrator. Reach for this to
  ship a feature fast.
- **Pattern 2 — standalone adapter** (vendor SDK + `@llmorch/core`). A
  self-contained `LLMProvider` re-implementation that self-registers, kept
  byte-for-byte identical to the canonical `@llmorch/adapter-<p>`. Reach for this
  to fork/vendor a single provider in isolation.
- **Pattern 3 — re-export wrapper** (`@llmorch/adapter-<p>` + convenience). The
  thinnest layer: re-exports the canonical adapter and adds `DEFAULT_MODEL`,
  `API_KEY_ENV`, and `create<Provider>Provider` / `create<Provider>Orchestrator`
  helpers. Reach for this when you already use the canonical adapter and just want
  the provider defaults pre-filled.

## Provider defaults

| Provider  | Env var             | Default model                | Notes                                  |
| --------- | ------------------- | ---------------------------- | -------------------------------------- |
| OpenAI    | `OPENAI_API_KEY`    | `gpt-4o-mini`                | Chat Completions baseline              |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-latest`   | Messages API                           |
| Gemini    | `GEMINI_API_KEY`    | `gemini-2.0-flash`           | `@google/genai`                        |
| Copilot   | `GITHUB_TOKEN`      | `gpt-4.1`                    | Copilot CLI SDK (`@github/copilot-sdk`)  |
| Local     | `LLMORCH_LOCAL_API_KEY` (optional) | `llama3.2`        | BYO `baseUrl`; OpenAI-compatible (Ollama default `http://localhost:11434/v1`) |

## Mock examples (local + private Azure)

`usecase-kit-adapter-local` ships two **fully offline** demos that exercise the
real `local` adapter (openai client → HTTP) against an in-process,
zero-dependency OpenAI-compatible mock server (`src/mock/openai-mock-server.ts`).
No credentials, no network, no running model:

```sh
pnpm --filter @llmorch-int/usecase-kit-adapter-local build
node ../../integrations/ts/usecase-kit-adapter-local/dist/examples/run-local-mock.js
node ../../integrations/ts/usecase-kit-adapter-local/dist/examples/run-azure-mock.js
```

- **`run-local-mock.ts`** — a self-hosted endpoint. Point `baseUrl` at the mock,
  then drive `ask` / `stream` / `extract` / `runTools`. Swap the mock URL for a
  real `http://localhost:11434/v1` (Ollama) / `:1234/v1` (LM Studio) and the rest
  is unchanged.
- **`run-azure-mock.ts`** — a **private Azure OpenAI deployment**. Shows the three
  Azure deltas the adapter handles via config: deployment-scoped URL, `api-key`
  header auth (`extraHeaders`), and `api-version`. Includes the 401 → typed
  `AuthenticationError` mapping when the key is wrong.

The mock's behavior is pinned in CI by `test/mock-server.test.ts`.

## Build & test

From `packages/ts` (the workspace root) — the integration packages are included
in the recursive scripts:

```sh
pnpm install
pnpm -r build
pnpm -r test
```

The 15 packages here are regenerated by `node integrations/ts/scripts/scaffold.mjs`
from the templates in `scripts/templates/`. The hand-authored mock server,
example scripts, and `mock-server.test.ts` under `usecase-kit-adapter-local/` are
**not** scaffold-generated, so re-running the scaffold leaves them untouched.
