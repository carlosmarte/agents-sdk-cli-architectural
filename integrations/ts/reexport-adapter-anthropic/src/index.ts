/**
 * @llmorch-int/reexport-adapter-anthropic — Pattern 3 of 3 (see ../README.md).
 *
 * The thinnest integration: it re-exports the canonical `@llmorch/adapter-anthropic`
 * (importing it self-registers the `anthropic` provider) and adds a small,
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

// Re-export the canonical adapter surface; this import self-registers `anthropic`.
export * from "@llmorch/adapter-anthropic";

/** The provider id registered by this package. */
export const PROVIDER_ID = "anthropic" as const;
/** Recommended default model for Anthropic Claude. */
export const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
/** Environment variable conventionally holding the credential. */
export const API_KEY_ENV = "ANTHROPIC_API_KEY";

/** Pre-fill the provider id + default model (+ base URL) for the helpers below. */
function withDefaults(opts: Partial<ProviderConfig>): Partial<ProviderConfig> {
  return {
    defaultModel: DEFAULT_MODEL,
    ...opts,
    provider: PROVIDER_ID,
    baseUrl: opts.baseUrl,
  };
}

/** Build a bare {@link LLMProvider} for Anthropic Claude (adapter already registered). */
export function createAnthropicProvider(
  opts: Partial<ProviderConfig> = {},
): LLMProvider {
  return createProvider(PROVIDER_ID, withDefaults(opts));
}

/** Build a single-provider {@link Orchestrator} for Anthropic Claude. */
export function createAnthropicOrchestrator(
  opts: Partial<ProviderConfig> = {},
  telemetry?: TelemetryHook,
): Orchestrator {
  return createOrchestrator(withDefaults(opts), { telemetry });
}
