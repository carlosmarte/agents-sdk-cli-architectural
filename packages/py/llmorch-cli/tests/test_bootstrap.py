"""Story 01 — Hexagonal CLI core: handler ↔ orchestrator parity (Python twin)."""

import asyncio

import typer
from llmorch_cli import app
from llmorch_cli.context import set_orchestrator_override
from llmorch_core import ChatRequest
from llmorch_core.testing import FakeProvider
from typer.testing import CliRunner

runner = CliRunner()


def test_app_is_typer() -> None:
    assert isinstance(app, typer.Typer)


def test_chat_output_matches_orchestrator() -> None:
    """A command driven via CliRunner renders exactly what orchestrator.chat returns."""
    orch = FakeProvider(text="Parity answer.")
    set_orchestrator_override(orch)
    try:
        result = runner.invoke(app, ["chat", "hi"])
        assert result.exit_code == 0
        direct = asyncio.run(
            orch.chat(ChatRequest(model="default", messages=[{"role": "user", "content": "hi"}]))
        )
        assert result.stdout.strip() == direct.text
    finally:
        set_orchestrator_override(None)


def test_help_exits_zero() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "Usage" in result.stdout
