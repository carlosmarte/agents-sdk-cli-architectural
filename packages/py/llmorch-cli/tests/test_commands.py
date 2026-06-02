"""Story 03 — per-command behavior + flag precedence against FakeProvider (Python twin)."""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from llmorch_cli import app
from llmorch_cli.context import set_orchestrator_override
from llmorch_cli.flags import resolve_flags
from llmorch_core.testing import FakeProvider
from typer.testing import CliRunner

runner = CliRunner()
SCHEMA = str(Path(__file__).parent / "fixtures" / "schema.json")


@pytest.fixture
def use_fake() -> Iterator[None]:
    """Install/clear the orchestrator override around a test."""
    try:
        yield
    finally:
        set_orchestrator_override(None)


def test_chat_prints_text(use_fake: None) -> None:
    set_orchestrator_override(FakeProvider(text="The answer."))
    result = runner.invoke(app, ["chat", "hello"])
    assert result.exit_code == 0
    assert result.stdout.strip() == "The answer."


def test_stream_concatenates_deltas(use_fake: None) -> None:
    set_orchestrator_override(FakeProvider(text="HelloThere"))
    result = runner.invoke(app, ["stream", "hello"])
    assert result.exit_code == 0
    assert result.stdout == "HelloThere"


def test_structured_prints_schema_valid_json(use_fake: None) -> None:
    payload = {"name": "Ada", "age": 36}
    set_orchestrator_override(FakeProvider(structured=payload))
    result = runner.invoke(app, ["structured", "extract", "--schema", SCHEMA])
    assert result.exit_code == 0
    assert json.loads(result.stdout) == payload


def test_structured_missing_schema_exits_nonzero(use_fake: None) -> None:
    set_orchestrator_override(FakeProvider(structured={}))
    result = runner.invoke(app, ["structured", "extract", "--schema", "/does/not/exist.json"])
    assert result.exit_code == 1


def test_providers_lists_four_with_resolved_config(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    result = runner.invoke(app, ["providers"])
    assert result.exit_code == 0
    ids = [line.split("  ")[0] for line in result.stdout.strip().splitlines()]
    assert ids == ["anthropic", "copilot", "gemini", "openai"]
    assert "openai  default_model=gpt-4o  key_present=true" in result.stdout
    assert "anthropic  default_model=claude-3-5-sonnet-latest  key_present=false" in result.stdout


def test_precedence_flag_over_env() -> None:
    resolved = resolve_flags({"provider": "gemini"}, {"LLMORCH_PROVIDER": "openai"})
    assert resolved.provider == "gemini"


def test_precedence_env_when_no_flag() -> None:
    resolved = resolve_flags({}, {"LLMORCH_PROVIDER": "openai"})
    assert resolved.provider == "openai"


def test_numeric_flags_resolve() -> None:
    resolved = resolve_flags({"temperature": 0.2, "max_tokens": 64})
    assert resolved.temperature == 0.2
    assert resolved.max_tokens == 64
