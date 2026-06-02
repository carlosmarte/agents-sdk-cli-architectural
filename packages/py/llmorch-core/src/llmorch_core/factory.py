"""Registry-backed factory — twin of packages/ts/core/src/factory.ts.

Adapters self-register via the `@register(id)` decorator at import time.
`create_provider` resolves an id to a constructed `LLMProvider`.
"""

from collections.abc import Callable, Mapping
from typing import Any, TypeVar

from .config import ProviderConfig, resolve_config
from .errors import UnknownProviderError
from .interface import LLMProvider

# Process-global registry: provider id → adapter constructor.
_REGISTRY: dict[str, Callable[..., LLMProvider]] = {}

P = TypeVar("P", bound=type[LLMProvider])


def register(provider_id: str) -> Callable[[P], P]:
    """Decorator registering an adapter class under a provider id (last-write-wins)."""

    def _decorator(cls: P) -> P:
        _REGISTRY[provider_id] = cls
        return cls

    return _decorator


def registered_providers() -> list[str]:
    """The provider ids currently registered."""
    return list(_REGISTRY.keys())


def create_provider(
    config_or_id: ProviderConfig | str,
    config: Mapping[str, Any] | None = None,
) -> LLMProvider:
    """Resolve a provider to a constructed LLMProvider.

    Accepts either a fully-resolved `ProviderConfig`, or a provider id plus an
    optional partial config dict (resolved via `resolve_config`).
    """
    if isinstance(config_or_id, ProviderConfig):
        cfg = config_or_id
    else:
        cfg = resolve_config(provider=config_or_id, **(config or {}))
    ctor = _REGISTRY.get(cfg.provider)
    if ctor is None:
        raise UnknownProviderError(cfg.provider, registered_providers())
    return ctor(cfg)
