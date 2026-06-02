import pytest
from llmorch_core import resolve_config
from pydantic import ValidationError

_ENV_VARS = [
    "LLMORCH_PROVIDER",
    "LLMORCH_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GITHUB_TOKEN",
]


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_explicit_api_key_beats_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "fromenv")
    cfg = resolve_config(provider="openai", api_key="explicit")
    assert cfg.api_key == "explicit"


def test_provider_specific_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "oai")
    cfg = resolve_config(provider="openai")
    assert cfg.api_key == "oai"


def test_llmorch_provider_selects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLMORCH_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "ak")
    cfg = resolve_config()
    assert cfg.provider == "anthropic"
    assert cfg.api_key == "ak"


def test_github_token_for_copilot(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_TOKEN", "ght")
    cfg = resolve_config(provider="copilot")
    assert cfg.api_key == "ght"


def test_llmorch_api_key_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLMORCH_API_KEY", "gen")
    cfg = resolve_config(provider="gemini")
    assert cfg.api_key == "gen"


def test_defaults_applied() -> None:
    cfg = resolve_config(provider="openai", api_key="k")
    assert cfg.timeout_ms == 30_000
    assert cfg.max_retries == 2


def test_no_resolvable_provider_raises() -> None:
    with pytest.raises(ValidationError):
        resolve_config()
