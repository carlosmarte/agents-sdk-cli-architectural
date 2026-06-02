# @llmorch-int/reexport-adapter-gemini

**Pattern 3 — thin re-export wrapper** for Google Gemini. Re-exports the canonical
`@llmorch/adapter-gemini` (importing self-registers `gemini`) and adds default
constants + `create*` helpers.

```ts
import {
  DEFAULT_MODEL,
  createGeminiOrchestrator,
} from "@llmorch-int/reexport-adapter-gemini";

const orch = createGeminiOrchestrator({ apiKey: process.env.GEMINI_API_KEY });
const res = await orch.chat({
  model: DEFAULT_MODEL,
  messages: [{ role: "user", content: "hi" }],
});
```

Exports: `PROVIDER_ID`, `DEFAULT_MODEL`, `API_KEY_ENV`,
`createGeminiProvider`, `createGeminiOrchestrator`, plus everything
re-exported from `@llmorch/adapter-gemini`.
