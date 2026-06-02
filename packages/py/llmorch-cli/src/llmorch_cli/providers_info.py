"""Static provider metadata — twin of the PROVIDER_INFO table in manifest.ts.

Feeds the ``providers`` command (default model + key-present) and the per-provider
default model used when no ``--model`` is given. Kept dependency-free so neither
``providers`` nor ``--help`` imports ``llmorch_sdk`` (and thus no provider SDK).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderInfo:
    id: str
    default_model: str
    key_env: str


# Sorted by id so the rendered order matches the TypeScript twin exactly.
PROVIDER_INFO: list[ProviderInfo] = [
    ProviderInfo("anthropic", "claude-3-5-sonnet-latest", "ANTHROPIC_API_KEY"),
    ProviderInfo("copilot", "gpt-4.1", "GITHUB_TOKEN"),
    ProviderInfo("gemini", "gemini-1.5-flash", "GEMINI_API_KEY"),
    ProviderInfo("local", "llama3.2", "LLMORCH_LOCAL_API_KEY"),
    ProviderInfo("openai", "gpt-4o", "OPENAI_API_KEY"),
]

_BY_ID = {p.id: p for p in PROVIDER_INFO}


def default_model_for(provider: str | None) -> str | None:
    """The default model for a provider id, or None for unknown ids (e.g. ``fake``)."""
    info = _BY_ID.get(provider) if provider else None
    return info.default_model if info else None
