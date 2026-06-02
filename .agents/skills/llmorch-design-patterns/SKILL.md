---
name: llmorch-design-patterns
description: Reference catalog of the design patterns the llmorch SDK+CLI is built on, with concrete code examples drawn from the codebase — Hexagonal ports & adapters, registry-backed factory, Singleton/stateless-method-call topology over data-only models, explicit client instances with native context propagation (no global hub), resilience-in-core (backoff/timeout/idempotency), the unified error taxonomy, directory-routed lazy-loaded CLI, the raw-payload escape hatch, and the in-core fake provider for testing. Use these as suggestions to apply when integrating with or extending llmorch — surface the relevant pattern when writing an adapter, an SDK integration, or a CLI; they are recommendations, not hard constraints.
---

# llmorch — Design Patterns (apply where they fit)

A catalog of the patterns this codebase already applies, with examples. When you integrate with or extend llmorch, **prefer** these idioms where they fit the situation — they keep new code consistent with the architecture. They are suggestions, not gates: deviate when a case genuinely calls for it, and note why.

Each pattern links to the focused skill that owns it in depth.

---

## 1. Hexagonal ports & adapters — one core, many edges
`LLMProvider` is the **port**; the SDK facade and the CLI are **driving** adapters; the four provider packages are **driven** adapters. The core knows nothing about HTTP, terminals, or vendor SDKs. *Apply when:* you add any new edge (a server route, a queue consumer, a second CLI) — make it a thin driving adapter over the same `Orchestrator`, never re-implement business logic. → `orchestration-devtool-hexagonal-core`
```
ChatRequest ─▶ [Orchestrator (core)] ─▶ LLMProvider port ─▶ vendor adapter ─▶ vendor SDK
```

## 2. Registry-backed factory — additive provider wiring
Adapters call `registerProvider(id, ctor)` / `@register(id)` at import; `LLMFactory.create(config)` resolves id → instance. Adding a provider touches no existing code. *Apply when:* you have a pluggable set of interchangeable implementations selected by a string id. → `llmorch-add-provider-adapter`
```ts
registerProvider("openai", OpenAIAdapter);     // side effect at module load
const provider = LLMFactory.create(resolveConfig({ provider: "openai" }));
```

## 3. Singleton topology over data-only models
Flat, stateless method calls (`orchestrator.chat(req)`) over plain validated data (`ChatRequest`, `UnifiedResponse`) — **not** deep, stateful resource-object graphs. Models are Zod (TS) / Pydantic (Py). *Apply when:* the surface is medium-to-large or schema-generated; reserve nested resource objects for small, shallow, intuitive APIs. → `orchestration-sdk-pattern-selector`

## 4. Explicit client instances + native context propagation — no global hub
You always construct an orchestrator (`createOrchestrator(...)`); there is no global API-key singleton. A per-call `traceId` rides `AsyncLocalStorage` (TS) / `ContextVars` (Py), so concurrent calls and multi-tenant use stay isolated. *Apply when:* integrating into a server or concurrent workload — pass an explicit instance, wrap work in `runWithTrace`, never stash config in module globals. → `orchestration-sdk-client-state-isolation`
```ts
runWithTrace(myTraceId, async () => { await orchestrator.chat(req); }); // nested calls inherit it
```

## 5. Resilience in the core, once — not per adapter
`withResilience` wraps every provider call: exponential backoff + full jitter on retriable errors, per-attempt timeout via `AbortController`, idempotency-key passthrough. Adapters and app code add **no** retry logic. *Apply when:* you're tempted to write a retry loop around a model call — tune `maxRetries`/`timeoutMs` on the config instead.

## 6. Unified error taxonomy with a `retriable` flag
One root, `OrchestrationError`; subtypes (`Authentication`, `RateLimit`, `Timeout`, `SchemaValidation`, `ToolExecution`, `UnsupportedFeature`, `UnknownProvider`, `Provider`). `retriable` drives fallback across the provider chain. *Apply when:* mapping a new vendor's errors (map status → taxonomy) or handling errors in an app (catch the root, branch on subtype). → `llmorch-add-provider-adapter`

## 7. Multi-provider fallback chain
`createOrchestrator([primary, fallback, …])`: a retriable failure fails over to the next entry; a non-retriable one propagates. *Apply when:* you need provider redundancy or graded cost/quality tiers — order the array, don't hand-roll try/catch ladders.

## 8. Schema translate-down, validate-up
For structured output: translate the high-level schema to JSON Schema for the vendor's enforcement, but **always** validate the returned JSON against the ORIGINAL schema (`parseOrThrow` / `parse_or_raise`). Recovers constraints providers silently drop (e.g. `minLength`, regex). *Apply when:* you accept structured output from any provider — never trust the vendor's enforcement as final.

## 9. Directory-routed, lazy-loaded CLI
Filesystem path = command path (oclif style). `--help` and metadata-only commands (`providers`) load no handler and no SDK; the heavy facade is `import()`ed only inside `buildOrchestrator`, only when a model call is actually needed. *Apply when:* adding a command — keep the handler thin and reach the orchestrator only via `ctx.getOrchestrator()`. → `orchestration-cli-routing-architect`

## 10. Raw-payload / structural escape hatch
Vendor-only request hints are read structurally (e.g. Anthropic's `cacheControl`) rather than widening the shared `ChatRequest`; the core stays provider-agnostic while a single adapter still exposes a vendor feature. *Apply when:* one provider needs a field the others don't — read it structurally in that adapter, don't pollute the unified contract.

## 11. In-core fake double for testing
`FakeProvider` ships in `core`, implements the full port offline, and is injectable as the orchestrator or via an adapter's `cachedClient` / `_cached_client`. *Apply when:* testing an integration — inject the fake (or a mocked vendor client), do **not** module-mock the vendor SDKs. → `orchestration-devtool-test-harness`

## 12. Polyglot twin parity
Every module exists in both TS and Python and must produce byte-equal normalized JSON against shared fixtures (`make ci-parity`). *Apply when:* you add or change behavior — land it in both twins and run the parity gate before calling it done.

---

## How to use this skill

When you're about to write an llmorch integration, adapter, or CLI command, scan this list and pull the patterns that fit — then dive into the linked focused skill for the mechanics. Treat #1–#6 as near-default for any non-trivial integration; #7–#12 as situational. The umbrella `orchestration-sdk-cli-architect` and `sdk-paradigms` skills hold the broader canon these draw from.

## Pointers

- Architecture breakdown by layer: `.plans/02/02-architecture-applied-skills.md`
- Source design: `.plans/01/AI SDK Orchestration Layer Design.md`
- Core implementations: `packages/ts/core/src/`, `packages/py/llmorch-core/src/llmorch_core/`
