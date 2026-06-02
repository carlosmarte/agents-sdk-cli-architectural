import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from llmorch_adapter_gemini import PROVIDER, GeminiAdapter, thinking_config_for
from llmorch_core import (
    AuthenticationError,
    ProviderConfig,
    RateLimitError,
    create_provider,
)
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="gemini", api_key="k")
REQ = ChatRequest(
    model="gemini-x",
    messages=[
        Message(role="system", content="be terse"),
        Message(role="user", content="hi"),
        Message(role="assistant", content="prior"),
    ],
    temperature=0.5,
    max_tokens=256,
    reasoning_effort="medium",
)
STUB = SimpleNamespace(
    text="hello",
    usage_metadata=SimpleNamespace(prompt_token_count=3, candidates_token_count=4),
    candidates=[SimpleNamespace(finish_reason="STOP")],
)


class _FakeModels:
    def __init__(self, result: Any = None, error: BaseException | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **params: Any) -> Any:
        self.calls.append(params)
        if self.error is not None:
            raise self.error
        return self.result


def _adapter_with(models: _FakeModels) -> GeminiAdapter:
    adapter = GeminiAdapter(CFG)
    adapter._cached_client = SimpleNamespace(aio=SimpleNamespace(models=models))
    return adapter


def test_provider_name() -> None:
    assert PROVIDER == "gemini"


def test_self_registers_under_gemini() -> None:
    assert isinstance(create_provider("gemini", {"api_key": "x"}), GeminiAdapter)


def test_thinking_config_maps_effort() -> None:
    assert thinking_config_for("medium") == {"thinking_budget": 8192}
    assert thinking_config_for(None) is None


def test_nests_generation_params_under_config() -> None:
    models = _FakeModels(result=STUB)
    asyncio.run(_adapter_with(models).chat(REQ))
    sent = models.calls[0]
    assert sent["model"] == "gemini-x"
    assert sent["config"]["system_instruction"] == "be terse"
    assert sent["config"]["max_output_tokens"] == 256
    assert sent["config"]["thinking_config"] == {"thinking_budget": 8192}
    # assistant role is remapped to "model"; system is hoisted out of contents
    assert [c["role"] for c in sent["contents"]] == ["user", "model"]


def test_extracts_text_and_usage() -> None:
    res = asyncio.run(_adapter_with(_FakeModels(result=STUB)).chat(REQ))
    assert res.text == "hello"
    assert res.usage.prompt_tokens == 3
    assert res.usage.completion_tokens == 4
    assert res.finish_reason == "stop"


def test_maps_permission_denied_to_auth_error() -> None:
    err = type("E", (Exception,), {"message": "PERMISSION_DENIED: nope"})()
    with pytest.raises(AuthenticationError):
        asyncio.run(_adapter_with(_FakeModels(error=err)).chat(REQ))


def test_maps_resource_exhausted_to_rate_limit_error() -> None:
    err = type("E", (Exception,), {"message": "RESOURCE_EXHAUSTED"})()
    with pytest.raises(RateLimitError):
        asyncio.run(_adapter_with(_FakeModels(error=err)).chat(REQ))
