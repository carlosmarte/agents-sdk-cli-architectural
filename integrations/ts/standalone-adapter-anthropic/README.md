# @llmorch-int/standalone-adapter-anthropic

**Pattern 2 — standalone re-implemented adapter** for Anthropic Claude. A self-contained
implementation of the `LLMProvider` port against the vendor SDK
(`@anthropic-ai/sdk`), independent of `@llmorch/adapter-anthropic`. Importing it
self-registers the `anthropic` provider, so you can vendor or fork this package
without pulling the canonical adapter.

```ts
import "@llmorch-int/standalone-adapter-anthropic"; // self-registers `anthropic`
import { createOrchestrator } from "@llmorch/core";

const orch = createOrchestrator({ provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY });
```

Maps all five modalities — chat, streaming, structured output, tool invoke,
tool resume — into the normalized core types, and translates the vendor error
shape into the unified error taxonomy.

> The implementation mirrors the canonical `@llmorch/adapter-anthropic` so the two
> stay behaviourally identical; this copy exists to be forked/vendored on its own.
