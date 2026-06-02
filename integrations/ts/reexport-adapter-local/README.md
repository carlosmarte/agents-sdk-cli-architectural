# @llmorch-int/reexport-adapter-local

**Pattern 3 — thin re-export wrapper** for a local / self-hosted or private LLM endpoint. Re-exports the canonical
`@llmorch/adapter-local` (importing self-registers `local`) and adds default
constants + `create*` helpers.

```ts
import {
  DEFAULT_MODEL,
  createLocalOrchestrator,
} from "@llmorch-int/reexport-adapter-local";

const orch = createLocalOrchestrator({ apiKey: process.env.LLMORCH_LOCAL_API_KEY });
const res = await orch.chat({
  model: DEFAULT_MODEL,
  messages: [{ role: "user", content: "hi" }],
});
```

Exports: `PROVIDER_ID`, `DEFAULT_MODEL`, `API_KEY_ENV`,
`createLocalProvider`, `createLocalOrchestrator`, plus everything
re-exported from `@llmorch/adapter-local`.
