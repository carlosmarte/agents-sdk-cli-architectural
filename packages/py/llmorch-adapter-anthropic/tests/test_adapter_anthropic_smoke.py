import asyncio
from types import SimpleNamespace
from typing import Any, cast

import pytest
from llmorch_adapter_anthropic import PROVIDER, AnthropicAdapter
from llmorch_core import (
    AuthenticationError,
    ProviderConfig,
    RateLimitError,
    create_provider,
)
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="anthropic", api_key="k")
REQ = ChatRequest(
    model="claude-x",
    messages=[
        Message(role="system", content="be terse"),
        Message(role="user", content="hi"),
    ],
    temperature=0.5,
)
STUB = SimpleNamespace(
    content=[SimpleNamespace(type="text", text="hello")],
    usage=SimpleNamespace(input_tokens=3, output_tokens=4),
    stop_reason="end_turn",
)


class _FakeMessages:
    def __init__(self, result: Any = None, error: BaseException | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def create(self, **params: Any) -> Any:
        self.calls.append(params)
        if self.error is not None:
            raise self.error
        return self.result


def _adapter_with(messages: _FakeMessages) -> AnthropicAdapter:
    adapter = AnthropicAdapter(CFG)
    adapter._cached_client = SimpleNamespace(messages=messages)
    return adapter


def _http_error(status: int) -> BaseException:
    return cast(BaseException, type("HttpError", (Exception,), {"status_code": status})())


def test_provider_name() -> None:
    assert PROVIDER == "anthropic"


def test_self_registers_under_anthropic() -> None:
    assert isinstance(create_provider("anthropic", {"api_key": "x"}), AnthropicAdapter)


def test_extracts_system_and_defaults_max_tokens() -> None:
    messages = _FakeMessages(result=STUB)
    asyncio.run(_adapter_with(messages).chat(REQ))
    sent = messages.calls[0]
    assert sent["system"] == "be terse"
    assert sent["max_tokens"] == 1024  # default when ChatRequest omits it
    assert [m["role"] for m in sent["messages"]] == ["user"]


def test_extracts_text_and_usage() -> None:
    res = asyncio.run(_adapter_with(_FakeMessages(result=STUB)).chat(REQ))
    assert res.text == "hello"
    assert res.usage.prompt_tokens == 3
    assert res.usage.completion_tokens == 4
    assert res.finish_reason == "stop"


def test_maps_max_tokens_stop_reason_to_length() -> None:
    stub = SimpleNamespace(
        content=[SimpleNamespace(type="text", text="x")],
        usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        stop_reason="max_tokens",
    )
    res = asyncio.run(_adapter_with(_FakeMessages(result=stub)).chat(REQ))
    assert res.finish_reason == "length"


def test_maps_401_to_auth_error() -> None:
    with pytest.raises(AuthenticationError):
        asyncio.run(_adapter_with(_FakeMessages(error=_http_error(401))).chat(REQ))


def test_maps_429_to_rate_limit_error() -> None:
    with pytest.raises(RateLimitError):
        asyncio.run(_adapter_with(_FakeMessages(error=_http_error(429))).chat(REQ))
