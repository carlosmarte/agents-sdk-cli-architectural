"""Single-rooted error taxonomy — twin of packages/ts/core/src/errors.ts."""


class OrchestrationError(Exception):
    """Root of the orchestration error hierarchy.

    Every other error subclasses this so callers can `except OrchestrationError`
    regardless of provider. Carries an optional `provider_id` and `cause` so the
    original provider exception is never lost.
    """

    def __init__(
        self,
        message: str,
        *,
        provider_id: str | None = None,
        cause: BaseException | None = None,
        retriable: bool = False,
    ) -> None:
        super().__init__(message)
        self.provider_id = provider_id
        self.cause = cause
        # Whether the orchestrator may fail over to the next provider in the chain.
        self.retriable = retriable
        if cause is not None:
            self.__cause__ = cause


class ProviderError(OrchestrationError):
    """Canonical wrapper for a provider-native error."""


class AuthenticationError(OrchestrationError):
    """Authentication / authorization failure (bad or missing credentials)."""


class RateLimitError(OrchestrationError):
    """Provider rate limit / quota exhaustion. Retriable by default (fails over)."""

    def __init__(
        self,
        message: str,
        *,
        provider_id: str | None = None,
        cause: BaseException | None = None,
        retriable: bool = True,
        retry_after_ms: int | None = None,
    ) -> None:
        super().__init__(message, provider_id=provider_id, cause=cause, retriable=retriable)
        self.retry_after_ms = retry_after_ms


class TimeoutError(OrchestrationError):
    """The request exceeded a configured or provider deadline (shadows builtin intentionally)."""


class SchemaValidationError(OrchestrationError):
    """Structured output failed to validate against the requested schema."""


class ToolExecutionError(OrchestrationError):
    """A host-side tool invocation raised while running a tool call."""


class UnsupportedFeatureError(OrchestrationError):
    """The provider does not support a requested feature/modality."""


class UnknownProviderError(OrchestrationError):
    """Raised by the factory when no adapter is registered for a provider id."""

    def __init__(self, provider_id: str, registered: list[str]) -> None:
        super().__init__(
            f'Unknown provider "{provider_id}". Registered providers: [{", ".join(registered)}]'
        )
        self.registered = registered
