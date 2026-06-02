# @llmorch-int/reexport-adapter-copilot

**Pattern 3 — thin re-export wrapper** for GitHub Copilot. Re-exports the canonical
`@llmorch/adapter-copilot` (importing self-registers `copilot`) and adds default
constants + `create*` helpers.

```ts
import {
  DEFAULT_MODEL,
  createCopilotOrchestrator,
} from "@llmorch-int/reexport-adapter-copilot";

const orch = createCopilotOrchestrator({ apiKey: process.env.GITHUB_TOKEN });
const res = await orch.chat({
  model: DEFAULT_MODEL,
  messages: [{ role: "user", content: "hi" }],
});
```

Exports: `PROVIDER_ID`, `DEFAULT_MODEL`, `API_KEY_ENV`,
`createCopilotProvider`, `createCopilotOrchestrator`, plus everything
re-exported from `@llmorch/adapter-copilot`.
