---
name: llmorch-add-provider-adapter
description: Add a new provider to the llmorch SDK by scaffolding a fresh adapter package (the Infrastructure / driven-adapter extension point) in TypeScript and Python. Covers implementing the LLMProvider port, self-registering into the factory at import time, mapping the five modalities (chat, streaming/SSE, structured output, tool invoke/resume) to and from the vendor SDK, normalizing the error taxonomy, wiring the package into the sdk facade + CLI provider table, and adding twin tests. Use when the user asks to "add a provider", "support <vendor> in llmorch", "write a new adapter", "wrap another LLM API", or to extend llmorch beyond OpenAI/Anthropic/Gemini/Copilot.
---

# llmorch — Add a Provider Adapter

llmorch is registry-backed: providers plug in as **driven adapters** behind the single `LLMProvider` port. Adding one is purely additive — no change to `core`, the orchestrator, or the CLI dispatch. This is the extension point the hexagonal architecture exists for (see `orchestration-devtool-hexagonal-core`).

## The contract you implement

`LLMProvider` (`core/src/interface.ts`, `llmorch_core.interface`):

```ts
interface LLMProvider {
  readonly providerId: string;
  chat(req: ChatRequest): Promise<UnifiedResponse>;
  stream(req: ChatRequest): AsyncGenerator<StreamChunk>;
  generateStructured<T>(req: ChatRequest, schema: ZodType<T>): Promise<T>;
  invokeTool(req: ChatRequest): Promise<UnifiedResponse>;
  resumeTool(req: ChatRequest, results: ToolResult[]): Promise<UnifiedResponse>;
}
```

Your adapter translates the normalized `ChatRequest` → the vendor request, and the vendor response → `UnifiedResponse`. It is the **only** place the vendor SDK is imported, and the only place network I/O happens. Do **not** add retries or timeouts — `core`'s resilience wraps every call already.

## Steps (do both languages — twins must reach parity)

1. **Scaffold the package**, mirroring an existing adapter. Pick the closest baseline: OpenAI is the 1:1 baseline; Anthropic shows system-extraction + mandatory `max_tokens` + text-block content + forced-tool structured output; Gemini shows `$ref` schema inlining; Copilot shows the REST-over-OpenAI-client pathway.
   - TS: `packages/ts/adapter-<id>/` with `package.json` (dep `@llmorch/core` `workspace:*` + the vendor SDK), `tsconfig.json`, `src/index.ts`.
   - Py: `packages/py/llmorch-adapter-<id>/` with `pyproject.toml`, `src/llmorch_adapter_<id>/__init__.py`, `py.typed`.
2. **Implement + self-register at module load.**
   ```ts
   import { registerProvider, type LLMProvider /* …models, errors, helpers */ } from "@llmorch/core";
   export class XAdapter implements LLMProvider {
     readonly providerId = "x";
     constructor(private readonly config: ProviderConfig) {}
     private cachedClient?: XLike;            // lazy; injectable for tests
     // chat / stream / generateStructured / invokeTool / resumeTool …
   }
   registerProvider("x", XAdapter);           // side effect at import
   ```
   ```python
   from llmorch_core import register, LLMProvider  # …models, errors, helpers
   @register("x")
   class XAdapter(LLMProvider):
       def __init__(self, config: ProviderConfig) -> None: ...
   ```
3. **Map requests/responses** to `UnifiedResponse { text, usage, toolCalls, finishReason }`. Normalize the vendor's finish reason to `"stop" | "length" | "tool_use" | "content_filter"` and usage to `TokenUsage { promptTokens, completionTokens, reasoningTokens? }`.
4. **Streaming** — convert the vendor SSE/event stream into `StreamChunk { delta, usage?, finishReason? }`; the terminal chunk carries usage + finish. Keep stream parsing in a separate module (`src/stream.ts`) like the Anthropic adapter.
5. **Structured output** — translate the schema with `zodToJsonSchema` / `model_to_json_schema` for the vendor's native enforcement, then **always** validate the returned JSON against the ORIGINAL schema with `parseOrThrow` / `parse_or_raise`. That recovers constraints a provider silently drops.
6. **Tools** — translate `req.tools` with the shared helper (`toOpenAITools` / `toAnthropicTools` / `toGeminiTools`, or a new one). `invokeTool` returns with `finishReason: "tool_use"` + populated `toolCalls`; `resumeTool` appends the `ToolResult`s in the vendor's shape and re-calls for the final answer.
7. **Errors** — write a `mapError` that maps vendor status → taxonomy: `401 → AuthenticationError`, `429 → RateLimitError` (retriable), other/5xx → `ProviderError` (set `retriable: true` for 5xx). Never let a raw vendor error escape; never double-wrap an `OrchestrationError`.
8. **Register the package** so the SDK and CLI see it:
   - `packages/ts/sdk/src/index.ts` + `packages/py/llmorch-sdk/.../__init__.py`: add the side-effect import.
   - `packages/ts/cli/src/manifest.ts` `PROVIDER_INFO` + `packages/py/.../providers_info.py`: add the row `{ id, defaultModel, keyEnv }` (keep TS and Py in lockstep).
   - `core/src/config.ts` `PROVIDER_KEY_ENV` + `ProviderIdSchema` (and the Py twin): add the id + its API-key env var.
9. **Tests** (twin): a smoke test (`chat` returns text), `stream`, and `structured` against a **mocked client injected via `cachedClient` / `_cached_client`** — do not module-mock the vendor SDK. Mirror the existing `adapter-*/test/` files.

## Verify

```bash
make -C packages ci-parity        # both langs green + TS↔Py parity
llmorch providers                 # your new id appears with its default model
LLMORCH_X_API_KEY=… llmorch chat "hi" --provider x
```

## Watch out

- **Self-registration only fires on import** — the SDK facade's side-effect import is what makes the provider discoverable; missing step 8 yields `UnknownProviderError`.
- **Keep it dependency-light** — the repo pins zero runtime deps beyond `zod`/`pydantic` + the vendor SDK, and enforces install-time release cooldowns. Prefer in-tree helpers over new packages.
- **Escape hatch for vendor-only fields** — read undocumented request hints structurally (e.g. Anthropic's `cacheControl`) rather than widening the shared `ChatRequest`. See `llmorch-design-patterns`.
- **Parity is a gate** — TS and Py must produce byte-equal normalized JSON against the shared fixtures (`make ci-parity`).

## Pointers

- Baseline adapters: `packages/ts/adapter-{openai,anthropic,gemini,copilot}/src/`, `packages/py/llmorch-adapter-*/`
- Shared helpers: `core/src/{schema,tools,errors}.ts`
- Adapter stories: `.plans/02/stories/04/`
