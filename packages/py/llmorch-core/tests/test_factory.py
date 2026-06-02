from collections.abc import Iterator

import llmorch_core.factory as factory_mod
import pytest
from fixtures.fake_provider import FakeProvider
from llmorch_core import (
    ProviderConfig,
    UnknownProviderError,
    create_provider,
    register,
    registered_providers,
)


@pytest.fixture(autouse=True)
def _isolate_registry() -> Iterator[None]:
    saved = dict(factory_mod._REGISTRY)
    factory_mod._REGISTRY.clear()
    yield
    factory_mod._REGISTRY.clear()
    factory_mod._REGISTRY.update(saved)


def test_create_resolves_registered() -> None:
    register("openai")(FakeProvider)
    provider = create_provider(ProviderConfig(provider="openai", api_key="k"))
    assert isinstance(provider, FakeProvider)
    assert "openai" in registered_providers()


def test_unknown_provider_raises() -> None:
    with pytest.raises(UnknownProviderError) as exc:
        create_provider(ProviderConfig(provider="gemini", api_key="k"))
    assert "gemini" in str(exc.value)


def test_last_write_wins() -> None:
    class A(FakeProvider):
        pass

    class B(FakeProvider):
        pass

    register("openai")(A)
    register("openai")(B)
    assert isinstance(create_provider(ProviderConfig(provider="openai", api_key="k")), B)
