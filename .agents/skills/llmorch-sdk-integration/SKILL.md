---
name: llmorch-sdk-integration
description: Integrate the llmorch SDK programmatically into a TypeScript (.mjs/.ts) or Python application — build an Orchestrator with createOrchestrator/create_orchestrator, run the five normalized modalities (chat, streaming, structured/JSON output, tool calling halt→resume), configure multi-provider fallback chains, attach a TelemetryHook, propagate a trace context, and handle the unified error taxonomy. Use when wiring llmorch into a service, agent, job, or library; when calling chat/stream/generate_structured/invoke_tool/resume_tool; or when the user asks to "use the SDK", "add an LLM call", "set up provider fallback", or "stream/structure model output" with llmorch.
---

# llmorch — SDK Integration

Embed the provider-agnostic `Orchestrator` in your code. You import one facade (`@llmorch/sdk` / `llmorch_sdk`), build an orchestrator from config, and call the same five methods regardless of provider. Nothing in your app imports a vendor SDK — that boundary lives in the adapters.

## Build the orchestrator

`createOrchestrator(config, opts?)` accepts a single partial config **or an ordered array** (the fallback chain). Each entry is resolved (explicit > env > default). The facade import is what self-registers the four adapters.

**TypeScript**
```ts
import { createOrchestrator } from "@llmorch/sdk";
import type { ChatRequest } from "@llmorch/core";

const orchestrator = createOrchestrator({ provider: "openai", defaultModel: "gpt-4o" });

const req: ChatRequest = {
  model: "gpt-4o",
  messages: [{ role: "user", content: "Summarize hexagonal architecture in one line." }],
};
const res = await orchestrator.chat(req);   // -> UnifiedResponse { text, usage, toolCalls, finishReason }
console.log(res.text, res.usage);
```

**Python** (every method is `async`)
```python
from llmorch_sdk import create_orchestrator
from llmorch_core import ChatRequest, Message

orch = create_orchestrator({"provider": "openai", "defaultModel": "gpt-4o"})
res = await orch.chat(ChatRequest(model="gpt-4o", messages=[Message(role="user", content="hi")]))
print(res.text, res.usage)
```

## The five modalities (the unified surface)

| Method (TS / Py) | Returns | Use for |
| --- | --- | --- |
| `chat` / `chat` | `UnifiedResponse` | one-shot prompt → answer |
| `stream` / `stream` | `AsyncGenerator`/`AsyncIterator` of `StreamChunk` | token streaming |
| `generateStructured` / `generate_structured` | `T` (validated) | JSON output validated against a schema |
| `invokeTool` / `invoke_tool` | `UnifiedResponse` (may halt with `toolCalls`) | start a tool-calling turn |
| `resumeTool` / `resume_tool` | `UnifiedResponse` | hand tool results back, get the final answer |

**Streaming**
```ts
for await (const chunk of orchestrator.stream(req)) process.stdout.write(chunk.delta);
```

**Structured output** — TS validates against a **Zod** schema; Python against a **Pydantic model**. Output is validated against the *original* schema even when a provider silently drops constraints.
```ts
import { z } from "zod";
const Person = z.object({ name: z.string(), age: z.number().int() });
const person = await orchestrator.generateStructured(req, Person);  // typed, validated
```
```python
from pydantic import BaseModel
class Person(BaseModel): name: str; age: int
person = await orch.generate_structured(req, Person)
```

**Tool calling — manual halt→resume loop.** `invokeTool` returns with `finishReason: "tool_use"` and a `toolCalls[]`; you run the tools host-side and call `resumeTool` with one `ToolResult` per call.
```ts
const first = await orchestrator.invokeTool({ ...req, tools: [toolDef], toolChoice: "auto" });
if (first.finishReason === "tool_use") {
  const results = first.toolCalls.map((c) => ({ id: c.id, name: c.name, content: runTool(c) }));
  const final = await orchestrator.resumeTool(req, results);
}
```

## Multi-provider fallback

Pass an array. A **retriable** error that survives resilience fails over to the next entry; a non-retriable one (e.g. `AuthenticationError`) propagates immediately.
```ts
const orch = createOrchestrator([
  { provider: "openai" },        // primary
  { provider: "anthropic" },     // fallback
]);
```

## Telemetry + trace context

Pass a `TelemetryHook`; every call fires `onRequestStart → (onToken…)? → onRequestEnd` or `→ onError`. A `traceId` is established per call via `AsyncLocalStorage` (TS) / `ContextVars` (Py) — no manual threading, no global hub.
```ts
import { StructuredLogTelemetryHook } from "@llmorch/core";
const orch = createOrchestrator({ provider: "openai" }, { telemetry: new StructuredLogTelemetryHook() });
```
To correlate llmorch calls with your own spans, wrap your work in `runWithTrace(traceId, fn)` / `run_with_trace`; nested orchestrator calls inherit it. Use `NoopTelemetryHook` (the default) to opt out.

## Resilience (free, in core)

Each provider call is wrapped with exponential backoff + full jitter, a per-attempt timeout, and idempotency-key passthrough. Tune per config entry: `timeoutMs` (default 30000), `maxRetries` (default 2). You do not add retry logic in your app.

## Error taxonomy — catch the root

Every error subclasses `OrchestrationError` (`retriable` flag drives fallback). Subtypes: `ProviderError`, `AuthenticationError`, `RateLimitError`, `TimeoutError`, `SchemaValidationError`, `ToolExecutionError`, `UnsupportedFeatureError`, `UnknownProviderError`.
```ts
import { OrchestrationError, AuthenticationError } from "@llmorch/core";
try { await orchestrator.chat(req); }
catch (e) {
  if (e instanceof AuthenticationError) { /* fix the key */ }
  else if (e instanceof OrchestrationError) { /* provider-agnostic handling */ }
}
```

## Testing your integration

Inject `FakeProvider` (from `@llmorch/core` / `llmorch_core.testing`) as the orchestrator in tests — it satisfies the full interface offline. See `orchestration-devtool-test-harness`. Do **not** module-mock the provider SDKs; inject `cachedClient` / `_cached_client` on an adapter when you must exercise adapter mapping.

## Apply the patterns

When integrating, prefer the idioms in `llmorch-design-patterns` (explicit client instances, native context propagation, the raw-payload escape hatch, Singleton method calls over data-only models). They are suggestions to apply where they fit, not hard requirements.

## Pointers

- Orchestrator: `packages/ts/core/src/orchestrator.ts`, `packages/py/llmorch-core/src/llmorch_core/orchestrator.py`
- Port + models: `core/src/interface.ts`, `core/src/models/`
- Facade: `packages/ts/sdk/src/index.ts`, `packages/py/llmorch-sdk/src/llmorch_sdk/__init__.py`
- Runnable examples: `.plans/02/examples/sdk/`
