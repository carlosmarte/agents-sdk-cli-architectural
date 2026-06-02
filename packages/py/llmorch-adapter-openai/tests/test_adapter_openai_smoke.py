import asyncio
from types import SimpleNamespace
from typing import Any, cast

import pytest
from llmorch_adapter_openai import PROVIDER, OpenAIAdapter
from llmorch_core import (
    AuthenticationError,
    ProviderConfig,
    RateLimitError,
    create_provider,
)
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="openai", api_key="k")
REQ = ChatRequest(
    model="gpt-x",
    messages=[Message(role="user", content="hi")],
    temperature=0.5,
    max_tokens=256,
)
STUB = SimpleNamespace(
    choices=[SimpleNamespace(message=SimpleNamespace(content="hello"), finish_reason="stop")],
    usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4),
)


class _FakeCompletions:
    def __init__(self, result: Any = None, error: BaseException | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def create(self, **params: Any) -> Any:
        self.calls.append(params)
        if self.error is not None:
            raise self.error
        return self.result


def _adapter_with(completions: _FakeCompletions) -> OpenAIAdapter:
    adapter = OpenAIAdapter(CFG)
    adapter._cached_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return adapter


def _http_error(status: int) -> BaseException:
    return cast(BaseException, type("HttpError", (Exception,), {"status_code": status})())


def test_provider_name() -> None:
    assert PROVIDER == "openai"


def test_self_registers_under_openai() -> None:
    assert isinstance(create_provider("openai", {"api_key": "x"}), OpenAIAdapter)


def test_maps_request_to_create_args() -> None:
    completions = _FakeCompletions(result=STUB)
    asyncio.run(_adapter_with(completions).chat(REQ))
    assert completions.calls[0]["model"] == "gpt-x"
    assert completions.calls[0]["temperature"] == 0.5
    assert completions.calls[0]["max_tokens"] == 256


def test_extracts_text_and_usage() -> None:
    res = asyncio.run(_adapter_with(_FakeCompletions(result=STUB)).chat(REQ))
    assert res.text == "hello"
    assert res.usage.prompt_tokens == 3
    assert res.usage.completion_tokens == 4
    assert res.finish_reason == "stop"


def test_maps_401_to_auth_error() -> None:
    with pytest.raises(AuthenticationError):
        asyncio.run(_adapter_with(_FakeCompletions(error=_http_error(401))).chat(REQ))


def test_maps_429_to_rate_limit_error() -> None:
    with pytest.raises(RateLimitError):
        asyncio.run(_adapter_with(_FakeCompletions(error=_http_error(429))).chat(REQ))
