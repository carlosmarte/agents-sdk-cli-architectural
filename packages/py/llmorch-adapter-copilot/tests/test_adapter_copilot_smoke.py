"""Copilot adapter smoke test — twin of adapter-copilot/test/copilot-adapter.test.ts.

The adapter shells out to the ``@github/copilot`` CLI; tests inject a fake runner
(an async generator yielding reply chunks) instead of spawning the binary.
"""

import asyncio
from collections.abc import AsyncIterator

import pytest
from llmorch_adapter_copilot import (
    COPILOT_CLI_ARGS,
    PROVIDER,
    CopilotAdapter,
    resolve_copilot_cli,
)
from llmorch_core import AuthenticationError, ProviderConfig, RateLimitError, create_provider
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="copilot", api_key="k")
REQ = ChatRequest(
    model="gpt-4.1",
    messages=[Message(role="user", content="hi")],
    temperature=0.5,
    max_tokens=256,
)


def _adapter(content: str = "hello", *, error: BaseException | None = None):
    prompts: list[str] = []

    async def run(prompt: str) -> AsyncIterator[str]:
        prompts.append(prompt)
        if error is not None:
            raise error
        yield content

    adapter = CopilotAdapter(CFG)
    adapter._runner = run
    return adapter, prompts


def test_provider_name() -> None:
    assert PROVIDER == "copilot"


def test_cli_args_disable_builtin_mcps() -> None:
    assert COPILOT_CLI_ARGS == ["--disable-builtin-mcps"]


def test_self_registers_under_copilot() -> None:
    assert isinstance(create_provider("copilot", {"api_key": "x"}), CopilotAdapter)


def test_resolve_copilot_cli_falls_back_to_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda _name: None)
    monkeypatch.setenv("COPILOT_CLI_PATH", "/custom/copilot")
    assert resolve_copilot_cli() == "/custom/copilot"


def test_chat_flattens_prompt_and_zeros_usage() -> None:
    adapter, prompts = _adapter("hello")
    res = asyncio.run(adapter.chat(REQ))
    assert res.text == "hello"
    assert res.usage.prompt_tokens == 0
    assert res.usage.completion_tokens == 0
    assert res.finish_reason == "stop"
    assert prompts[0] == "hi"


def test_invoke_tool_answers_directly() -> None:
    adapter, _ = _adapter("done")
    res = asyncio.run(adapter.invoke_tool(REQ))
    assert res.tool_calls == []
    assert res.finish_reason == "stop"
    assert res.text == "done"


def test_maps_auth_error_from_message() -> None:
    adapter, _ = _adapter(error=RuntimeError("401 unauthorized"))
    with pytest.raises(AuthenticationError):
        asyncio.run(adapter.chat(REQ))


def test_maps_rate_limit_error_from_message() -> None:
    adapter, _ = _adapter(error=RuntimeError("rate limit exceeded"))
    with pytest.raises(RateLimitError):
        asyncio.run(adapter.chat(REQ))
