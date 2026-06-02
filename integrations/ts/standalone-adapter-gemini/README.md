# @llmorch-int/standalone-adapter-gemini

**Pattern 2 — standalone re-implemented adapter** for Google Gemini. A self-contained
implementation of the `LLMProvider` port against the vendor SDK
(`@google/genai`), independent of `@llmorch/adapter-gemini`. Importing it
self-registers the `gemini` provider, so you can vendor or fork this package
without pulling the canonical adapter.

```ts
import "@llmorch-int/standalone-adapter-gemini"; // self-registers `gemini`
import { createOrchestrator } from "@llmorch/core";

const orch = createOrchestrator({ provider: "gemini", apiKey: process.env.GEMINI_API_KEY });
```

Maps all five modalities — chat, streaming, structured output, tool invoke,
tool resume — into the normalized core types, and translates the vendor error
shape into the unified error taxonomy.

> The implementation mirrors the canonical `@llmorch/adapter-gemini` so the two
> stay behaviourally identical; this copy exists to be forked/vendored on its own.
