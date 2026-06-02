/** Options accepted by every error in the taxonomy. */
export interface OrchestrationErrorOptions {
  providerId?: string;
  cause?: unknown;
  /** Whether the orchestrator may fail over to the next provider in the chain. */
  retriable?: boolean;
}

/**
 * Root of the orchestration error hierarchy. Every other error subclasses this,
 * so callers can `catch (e) { if (e instanceof OrchestrationError) ... }`
 * regardless of provider. The `retriable` flag drives orchestrator fallback.
 */
export class OrchestrationError extends Error {
  readonly providerId?: string;
  readonly retriable: boolean;

  constructor(message: string, options: OrchestrationErrorOptions = {}) {
    super(message, { cause: options.cause });
    // `new.target` + setPrototypeOf keep `instanceof` working after transpilation.
    this.name = new.target.name;
    this.providerId = options.providerId;
    this.retriable = options.retriable ?? false;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Canonical wrapper for a provider-native error (carries `providerId` + `cause`). */
export class ProviderError extends OrchestrationError {}

/** Authentication / authorization failure (bad or missing credentials). */
export class AuthenticationError extends OrchestrationError {}

/** Options for {@link RateLimitError}, optionally carrying a retry hint. */
export interface RateLimitErrorOptions extends OrchestrationErrorOptions {
  retryAfterMs?: number;
}

/** Provider rate limit / quota exhaustion. Retriable by default (orchestrator fails over). */
export class RateLimitError extends OrchestrationError {
  readonly retryAfterMs?: number;

  constructor(message: string, options: RateLimitErrorOptions = {}) {
    super(message, { ...options, retriable: options.retriable ?? true });
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** The request exceeded a configured or provider deadline. */
export class TimeoutError extends OrchestrationError {}

/** Structured output failed to validate against the requested schema. */
export class SchemaValidationError extends OrchestrationError {}

/** A host-side tool invocation raised while running a tool call. */
export class ToolExecutionError extends OrchestrationError {}

/** The provider does not support a requested feature/modality. */
export class UnsupportedFeatureError extends OrchestrationError {}

/** Raised by the factory when no adapter is registered for a requested provider id. */
export class UnknownProviderError extends OrchestrationError {
  readonly registered: string[];

  constructor(provider: string, registered: string[]) {
    super(
      `Unknown provider "${provider}". Registered providers: [${registered.join(", ")}]`,
    );
    this.registered = registered;
  }
}
