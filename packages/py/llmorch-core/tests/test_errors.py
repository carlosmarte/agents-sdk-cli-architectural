import pytest
from llmorch_core.errors import (
    AuthenticationError,
    OrchestrationError,
    ProviderError,
    RateLimitError,
    SchemaValidationError,
    TimeoutError,
    ToolExecutionError,
    UnsupportedFeatureError,
)

SUBCLASSES = [
    ProviderError,
    AuthenticationError,
    RateLimitError,
    TimeoutError,
    SchemaValidationError,
    ToolExecutionError,
    UnsupportedFeatureError,
]


def test_every_subclass_is_orchestration_error() -> None:
    for cls in SUBCLASSES:
        err = cls("boom")
        assert isinstance(err, OrchestrationError)
        assert isinstance(err, Exception)


def test_cause_preserved() -> None:
    original = ValueError("root")
    err = ProviderError("wrapped", provider_id="openai", cause=original)
    assert err.cause is original
    assert err.__cause__ is original
    assert err.provider_id == "openai"


def test_default_provider_id_is_none() -> None:
    assert RateLimitError("m").provider_id is None


def test_catchable_via_base() -> None:
    with pytest.raises(OrchestrationError):
        raise TimeoutError("slow")


def test_raise_from_preserves_chain() -> None:
    original = ValueError("root")
    try:
        try:
            raise original
        except ValueError as exc:
            raise ProviderError("m", cause=exc) from exc
    except ProviderError as err:
        assert err.__cause__ is original
