/**
 * @llmorch-int/reexport-adapter-local — Pattern 3 of 3 (see ../README.md).
 *
 * The thinnest integration: it re-exports the canonical `@llmorch/adapter-local`
 * (importing it self-registers the `local` provider) and adds a small,
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

// Re-export the canonical adapter surface; this import self-registers `local`.
export * from "@llmorch/adapter-local";

/** The provider id registered by this package. */
export const PROVIDER_ID = "local" as const;
/** Recommended default model for a local / self-hosted or private LLM endpoint. */
export const DEFAULT_MODEL = "llama3.2";
/** Environment variable conventionally holding the credential. */
export const API_KEY_ENV = "LLMORCH_LOCAL_API_KEY";
/** Default endpoint when none is supplied (Ollama's OpenAI-compatible path); override via `baseUrl` / `LLMORCH_BASE_URL` for LM Studio, vLLM, or a private Azure deployment. */
export const BASE_URL = "http://localhost:11434/v1";

/** Pre-fill the provider id + default model (+ base URL) for the helpers below. */
function withDefaults(opts: Partial<ProviderConfig>): Partial<ProviderConfig> {
  return {
    defaultModel: DEFAULT_MODEL,
    ...opts,
    provider: PROVIDER_ID,
    baseUrl: opts.baseUrl ?? BASE_URL,
  };
}

/** Build a bare {@link LLMProvider} for a local / self-hosted or private LLM endpoint (adapter already registered). */
export function createLocalProvider(
  opts: Partial<ProviderConfig> = {},
): LLMProvider {
  return createProvider(PROVIDER_ID, withDefaults(opts));
}

/** Build a single-provider {@link Orchestrator} for a local / self-hosted or private LLM endpoint. */
export function createLocalOrchestrator(
  opts: Partial<ProviderConfig> = {},
  telemetry?: TelemetryHook,
): Orchestrator {
  return createOrchestrator(withDefaults(opts), { telemetry });
}
