/**
 * @llmorch-int/reexport-adapter-gemini — Pattern 3 of 3 (see ../README.md).
 *
 * The thinnest integration: it re-exports the canonical `@llmorch/adapter-gemini`
 * (importing it self-registers the `gemini` provider) and adds a small,
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

// Re-export the canonical adapter surface; this import self-registers `gemini`.
export * from "@llmorch/adapter-gemini";

/** The provider id registered by this package. */
export const PROVIDER_ID = "gemini" as const;
/** Recommended default model for Google Gemini. */
export const DEFAULT_MODEL = "gemini-2.0-flash";
/** Environment variable conventionally holding the credential. */
export const API_KEY_ENV = "GEMINI_API_KEY";

/** Pre-fill the provider id + default model (+ base URL) for the helpers below. */
function withDefaults(opts: Partial<ProviderConfig>): Partial<ProviderConfig> {
  return {
    defaultModel: DEFAULT_MODEL,
    ...opts,
    provider: PROVIDER_ID,
    baseUrl: opts.baseUrl,
  };
}

/** Build a bare {@link LLMProvider} for Google Gemini (adapter already registered). */
export function createGeminiProvider(
  opts: Partial<ProviderConfig> = {},
): LLMProvider {
  return createProvider(PROVIDER_ID, withDefaults(opts));
}

/** Build a single-provider {@link Orchestrator} for Google Gemini. */
export function createGeminiOrchestrator(
  opts: Partial<ProviderConfig> = {},
  telemetry?: TelemetryHook,
): Orchestrator {
  return createOrchestrator(withDefaults(opts), { telemetry });
}
