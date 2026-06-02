/** @llmorch/sdk — batteries-included facade: registers adapters, exports createOrchestrator. */

// Side-effect imports: each adapter calls registerProvider(...) at module load.
import "@llmorch/adapter-openai";
import "@llmorch/adapter-anthropic";
import "@llmorch/adapter-gemini";
import "@llmorch/adapter-copilot";

export { createOrchestrator, registeredProviders } from "@llmorch/core";
export type { Orchestrator, ProviderConfig, TelemetryHook } from "@llmorch/core";
