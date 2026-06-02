# @llmorch-int/reexport-adapter-anthropic

**Pattern 3 — thin re-export wrapper** for Anthropic Claude. Re-exports the canonical
`@llmorch/adapter-anthropic` (importing self-registers `anthropic`) and adds default
constants + `create*` helpers.

```ts
import {
  DEFAULT_MODEL,
  createAnthropicOrchestrator,
} from "@llmorch-int/reexport-adapter-anthropic";

const orch = createAnthropicOrchestrator({ apiKey: process.env.ANTHROPIC_API_KEY });
const res = await orch.chat({
  model: DEFAULT_MODEL,
  messages: [{ role: "user", content: "hi" }],
});
```

Exports: `PROVIDER_ID`, `DEFAULT_MODEL`, `API_KEY_ENV`,
`createAnthropicProvider`, `createAnthropicOrchestrator`, plus everything
re-exported from `@llmorch/adapter-anthropic`.
