import { z } from "zod";

/**
 * The supported provider ids. `local` is the bring-your-own-endpoint provider:
 * it speaks the OpenAI wire protocol against a user-supplied `baseUrl`, letting
 * a private / self-hosted LLM (Ollama, LM Studio, vLLM, llama.cpp server,
 * LocalAI, …) flow through the exact same pipeline as the hosted providers.
 */
export const ProviderIdSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "copilot",
  "local",
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** Fully-resolved provider configuration consumed by the factory + orchestrator. */
export const ProviderConfigSchema = z.object({
  provider: ProviderIdSchema,
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** provider id → its provider-specific API-key environment variable. */
const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  copilot: "GITHUB_TOKEN",
  // Local servers usually need no key; this is honored when one is set (e.g. a
  // reverse-proxied endpoint), and the adapter falls back to a placeholder.
  local: "LLMORCH_LOCAL_API_KEY",
};

/**
 * Resolve a `ProviderConfig` with precedence: explicit partial > env > defaults.
 * `env` is injectable so tests need not mutate the global `process.env`.
 */
export function resolveConfig(
  partial: Partial<ProviderConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfig {
  const provider = partial.provider ?? env.LLMORCH_PROVIDER;
  const providerKey =
    provider && provider in PROVIDER_KEY_ENV
      ? env[PROVIDER_KEY_ENV[provider as ProviderId]]
      : undefined;
  const apiKey = partial.apiKey ?? providerKey ?? env.LLMORCH_API_KEY;
  // A provider-agnostic endpoint override. The `local` adapter relies on this
  // (or its own default) to reach a self-hosted server; hosted adapters may use
  // it to target a compatible proxy.
  const baseUrl = partial.baseUrl ?? env.LLMORCH_BASE_URL;

  return ProviderConfigSchema.parse({
    ...partial,
    provider,
    apiKey,
    baseUrl,
    timeoutMs: partial.timeoutMs ?? 30_000,
    maxRetries: partial.maxRetries ?? 2,
  });
}
