# @llmorch-int/standalone-adapter-openai

**Pattern 2 — standalone re-implemented adapter** for OpenAI. A self-contained
implementation of the `LLMProvider` port against the vendor SDK
(`openai`), independent of `@llmorch/adapter-openai`. Importing it
self-registers the `openai` provider, so you can vendor or fork this package
without pulling the canonical adapter.

```ts
import "@llmorch-int/standalone-adapter-openai"; // self-registers `openai`
import { createOrchestrator } from "@llmorch/core";

const orch = createOrchestrator({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });
```

Maps all five modalities — chat, streaming, structured output, tool invoke,
tool resume — into the normalized core types, and translates the vendor error
shape into the unified error taxonomy.

> The implementation mirrors the canonical `@llmorch/adapter-openai` so the two
> stay behaviourally identical; this copy exists to be forked/vendored on its own.
