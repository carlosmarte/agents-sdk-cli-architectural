import { type ProviderConfig, type ProviderId, resolveConfig } from "./config.js";
import { UnknownProviderError } from "./errors.js";
import type { LLMProvider } from "./interface.js";

/** An adapter constructor: built from a resolved {@link ProviderConfig}. */
export type ProviderCtor = new (config: ProviderConfig) => LLMProvider;

/** Process-global registry: provider id → adapter constructor. */
const ProviderRegistry = new Map<string, ProviderCtor>();

/**
 * Register an adapter constructor under a provider id. Adapters call this at
 * import time so the SDK can self-wire. Last-write-wins (re-registration
 * overwrites; documented behavior).
 */
export function registerProvider(id: string, ctor: ProviderCtor): void {
  ProviderRegistry.set(id, ctor);
}

/** The provider ids currently registered. */
export function registeredProviders(): string[] {
  return [...ProviderRegistry.keys()];
}

/** Creational seam: resolve a provider id to a constructed {@link LLMProvider}. */
export class LLMFactory {
  static create(config: ProviderConfig): LLMProvider {
    const ctor = ProviderRegistry.get(config.provider);
    if (!ctor) {
      throw new UnknownProviderError(config.provider, registeredProviders());
    }
    return new ctor(config);
  }
}

/**
 * Convenience: build a provider by id, resolving the rest of the config from a
 * partial + environment. `createProvider("openai", { apiKey })`.
 */
export function createProvider(
  providerId: string,
  config: Partial<ProviderConfig> = {},
): LLMProvider {
  return LLMFactory.create(
    resolveConfig({ ...config, provider: providerId as ProviderId }),
  );
}
