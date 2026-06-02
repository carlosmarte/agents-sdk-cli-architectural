# @llmorch-int/standalone-adapter-local

**Pattern 2 — standalone re-implemented adapter** for a local / self-hosted or private LLM endpoint. A self-contained
implementation of the `LLMProvider` port against the vendor SDK
(`openai`), independent of `@llmorch/adapter-local`. Importing it
self-registers the `local` provider, so you can vendor or fork this package
without pulling the canonical adapter.

```ts
import "@llmorch-int/standalone-adapter-local"; // self-registers `local`
import { createOrchestrator } from "@llmorch/core";

const orch = createOrchestrator({ provider: "local", apiKey: process.env.LLMORCH_LOCAL_API_KEY });
```

Maps all five modalities — chat, streaming, structured output, tool invoke,
tool resume — into the normalized core types, and translates the vendor error
shape into the unified error taxonomy.

> The implementation mirrors the canonical `@llmorch/adapter-local` so the two
> stay behaviourally identical; this copy exists to be forked/vendored on its own.
