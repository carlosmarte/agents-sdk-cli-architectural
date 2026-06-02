/**
 * @llmorch-int/reexport-adapter-openai — Pattern 3 of 3 (see ../README.md).
 *
 * The thinnest integration: it re-exports the canonical `@llmorch/adapter-openai`
 * (importing it self-registers the `openai` provider) and adds a small,
 * provider-specific convenience layer — the default model, the API-key env var,
 * and `create*` factory helpers — so callers don't re-type those constants.
 */
import {
  createOrchestrator,
  createProvider,
  type LLMProvider,
  type Orchestrator,
  type ProviderConfig,
  type TelemetryHook,
} from "@llmorch/core";

// Re-export the canonical adapter surface; this import self-registers `openai`.
export * from "@llmorch/adapter-openai";

/** The provider id registered by this package. */
export const PROVIDER_ID = "openai" as const;
/** Recommended default model for OpenAI. */
export const DEFAULT_MODEL = "gpt-4o-mini";
/** Environment variable conventionally holding the credential. */
export const API_KEY_ENV = "OPENAI_API_KEY";

/** Pre-fill the provider id + default model (+ base URL) for the helpers below. */
function withDefaults(opts: Partial<ProviderConfig>): Partial<ProviderConfig> {
  return {
    defaultModel: DEFAULT_MODEL,
    ...opts,
    provider: PROVIDER_ID,
    baseUrl: opts.baseUrl,
  };
}

/** Build a bare {@link LLMProvider} for OpenAI (adapter already registered). */
export function createOpenAIProvider(
  opts: Partial<ProviderConfig> = {},
): LLMProvider {
  return createProvider(PROVIDER_ID, withDefaults(opts));
}

/** Build a single-provider {@link Orchestrator} for OpenAI. */
export function createOpenAIOrchestrator(
  opts: Partial<ProviderConfig> = {},
  telemetry?: TelemetryHook,
): Orchestrator {
  return createOrchestrator(withDefaults(opts), { telemetry });
}
