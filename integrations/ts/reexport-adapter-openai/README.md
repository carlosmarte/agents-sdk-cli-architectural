# @llmorch-int/reexport-adapter-openai

**Pattern 3 — thin re-export wrapper** for OpenAI. Re-exports the canonical
`@llmorch/adapter-openai` (importing self-registers `openai`) and adds default
constants + `create*` helpers.

```ts
import {
  DEFAULT_MODEL,
  createOpenAIOrchestrator,
} from "@llmorch-int/reexport-adapter-openai";

const orch = createOpenAIOrchestrator({ apiKey: process.env.OPENAI_API_KEY });
const res = await orch.chat({
  model: DEFAULT_MODEL,
  messages: [{ role: "user", content: "hi" }],
});
```

Exports: `PROVIDER_ID`, `DEFAULT_MODEL`, `API_KEY_ENV`,
`createOpenAIProvider`, `createOpenAIOrchestrator`, plus everything
re-exported from `@llmorch/adapter-openai`.
