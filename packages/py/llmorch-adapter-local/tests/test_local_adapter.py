import asyncio
from types import SimpleNamespace
from typing import Any, cast

from llmorch_adapter_local import (
    DEFAULT_LOCAL_BASE_URL,
    PROVIDER,
    LocalAdapter,
)
from llmorch_core import (
    AuthenticationError,
    ProviderConfig,
    ProviderError,
    create_provider,
)
from llmorch_core.models import ChatRequest, Message
from pydantic import BaseModel

CFG = ProviderConfig(provider="local")
REQ = ChatRequest(
    model="llama3.2",
    messages=[Message(role="user", content="hi")],
    temperature=0.5,
    max_tokens=256,
)
STUB = SimpleNamespace(
    choices=[SimpleNamespace(message=SimpleNamespace(content="hey"), finish_reason="stop")],
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


def _adapter_with(completions: _FakeCompletions, cfg: ProviderConfig = CFG) -> LocalAdapter:
    adapter = LocalAdapter(cfg)
    adapter._cached_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return adapter


def _http_error(status: int) -> BaseException:
    return cast(BaseException, type("HttpError", (Exception,), {"status_code": status})())


def test_provider_name() -> None:
    assert PROVIDER == "local"


def test_self_registers_under_local() -> None:
    assert isinstance(create_provider("local", {}), LocalAdapter)


def test_defaults_base_url_to_ollama_path() -> None:
    assert LocalAdapter(CFG)._base_url == DEFAULT_LOCAL_BASE_URL


def test_honors_explicit_base_url() -> None:
    cfg = ProviderConfig(provider="local", base_url=cast(Any, "http://localhost:1234/v1"))
    assert LocalAdapter(cfg)._base_url.rstrip("/") == "http://localhost:1234/v1"


def test_chat_maps_to_unified_response() -> None:
    completions = _FakeCompletions(result=STUB)
    res = asyncio.run(_adapter_with(completions).chat(REQ))
    assert completions.calls[0]["model"] == "llama3.2"
    assert completions.calls[0]["temperature"] == 0.5
    assert res.text == "hey"
    assert res.usage.prompt_tokens == 3
    assert res.usage.completion_tokens == 4
    assert res.finish_reason == "stop"
    assert res.tool_calls == []


def test_structured_steers_json_object_and_validates() -> None:
    class Person(BaseModel):
        name: str
        age: int

    completions = _FakeCompletions(
        result=SimpleNamespace(
            choices=[
                SimpleNamespace(message=SimpleNamespace(content='{"name":"Ada","age":36}'))
            ]
        )
    )
    out = asyncio.run(_adapter_with(completions).generate_structured(REQ, Person))
    assert out == Person(name="Ada", age=36)
    params = completions.calls[0]
    assert params["response_format"] == {"type": "json_object"}
    assert params["messages"][0]["role"] == "system"


def test_maps_401_to_authentication_error() -> None:
    completions = _FakeCompletions(error=_http_error(401))
    try:
        asyncio.run(_adapter_with(completions).chat(REQ))
        raise AssertionError("expected AuthenticationError")
    except AuthenticationError:
        pass


def test_connection_refusal_is_retriable_provider_error_naming_endpoint() -> None:
    completions = _FakeCompletions(error=ConnectionRefusedError(61, "refused"))
    try:
        asyncio.run(_adapter_with(completions).chat(REQ))
        raise AssertionError("expected ProviderError")
    except ProviderError as err:
        assert err.retriable is True
        assert DEFAULT_LOCAL_BASE_URL in str(err)
