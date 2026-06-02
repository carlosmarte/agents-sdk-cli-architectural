# @llmorch-int/standalone-adapter-copilot

**Pattern 2 — standalone re-implemented adapter** for GitHub Copilot. A self-contained
implementation of the `LLMProvider` port against the vendor SDK
(`@github/copilot-sdk`), independent of `@llmorch/adapter-copilot`. Importing it
self-registers the `copilot` provider, so you can vendor or fork this package
without pulling the canonical adapter.

```ts
import "@llmorch-int/standalone-adapter-copilot"; // self-registers `copilot`
import { createOrchestrator } from "@llmorch/core";

const orch = createOrchestrator({ provider: "copilot", apiKey: process.env.GITHUB_TOKEN });
```

Maps all five modalities — chat, streaming, structured output, tool invoke,
tool resume — into the normalized core types, and translates the vendor error
shape into the unified error taxonomy.

> The implementation mirrors the canonical `@llmorch/adapter-copilot` so the two
> stay behaviourally identical; this copy exists to be forked/vendored on its own.
