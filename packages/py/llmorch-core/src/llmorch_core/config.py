"""Config resolution — twin of packages/ts/core/src/config.ts.

Precedence: explicit partial > environment > defaults. The env layer is read
via pydantic-settings; field names are snake_case twins of the TS camelCase shape.
"""

from typing import Any, Literal

from pydantic import BaseModel, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderId = Literal["openai", "anthropic", "gemini", "copilot"]

# provider id → the snake_case _EnvSettings field holding its provider-specific key.
_PROVIDER_KEY_FIELD: dict[str, str] = {
    "openai": "openai_api_key",
    "anthropic": "anthropic_api_key",
    "gemini": "gemini_api_key",
    "copilot": "github_token",
}


class ProviderConfig(BaseModel):
    provider: ProviderId
    api_key: str | None = None
    base_url: HttpUrl | None = None
    default_model: str | None = None
    timeout_ms: int = 30_000
    max_retries: int = 2
    extra_headers: dict[str, str] = {}


class _EnvSettings(BaseSettings):
    """Reads the environment layer. `LLMORCH_*` selectors + provider-specific keys."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    llmorch_provider: str | None = None
    llmorch_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    github_token: str | None = None


def resolve_config(**partial: Any) -> ProviderConfig:
    """Resolve a ProviderConfig from explicit kwargs over env over defaults."""
    env = _EnvSettings()
    provider = partial.get("provider") or env.llmorch_provider

    provider_key: str | None = None
    if provider is not None:
        field = _PROVIDER_KEY_FIELD.get(provider)
        if field is not None:
            provider_key = getattr(env, field, None)

    api_key = partial.get("api_key") or provider_key or env.llmorch_api_key
    merged: dict[str, Any] = {**partial, "provider": provider, "api_key": api_key}
    return ProviderConfig.model_validate({k: v for k, v in merged.items() if v is not None})
