/**
 * @llmorch-int/reexport-adapter-copilot — Pattern 3 of 3 (see ../README.md).
 *
 * The thinnest integration: it re-exports the canonical `@llmorch/adapter-copilot`
 * (importing it self-registers the `copilot` provider) and adds a small,
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

// Re-export the canonical adapter surface; this import self-registers `copilot`.
export * from "@llmorch/adapter-copilot";

/** The provider id registered by this package. */
export const PROVIDER_ID = "copilot" as const;
/** Recommended default model for GitHub Copilot. */
export const DEFAULT_MODEL = "gpt-4.1";
/** Environment variable conventionally holding the credential. */
export const API_KEY_ENV = "GITHUB_TOKEN";

/** Pre-fill the provider id + default model (+ base URL) for the helpers below. */
function withDefaults(opts: Partial<ProviderConfig>): Partial<ProviderConfig> {
  return {
    defaultModel: DEFAULT_MODEL,
    ...opts,
    provider: PROVIDER_ID,
    baseUrl: opts.baseUrl,
  };
}

/** Build a bare {@link LLMProvider} for GitHub Copilot (adapter already registered). */
export function createCopilotProvider(
  opts: Partial<ProviderConfig> = {},
): LLMProvider {
  return createProvider(PROVIDER_ID, withDefaults(opts));
}

/** Build a single-provider {@link Orchestrator} for GitHub Copilot. */
export function createCopilotOrchestrator(
  opts: Partial<ProviderConfig> = {},
  telemetry?: TelemetryHook,
): Orchestrator {
  return createOrchestrator(withDefaults(opts), { telemetry });
}
