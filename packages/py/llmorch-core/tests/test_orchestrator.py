import asyncio
from collections.abc import Iterator
from typing import Any

import llmorch_core.factory as factory_mod
import pytest
from fixtures.fake_provider import FakeProvider
from llmorch_core import (
    ProviderError,
    RateLimitError,
    create_orchestrator,
    register,
)
from llmorch_core.models import ChatRequest, Message, ToolResult, UnifiedResponse

REQ = ChatRequest(model="m", messages=[Message(role="user", content="hi")])

CHAIN: list[dict[str, Any]] = [
    {"provider": "openai", "api_key": "k"},
    {"provider": "anthropic", "api_key": "k"},
]


@pytest.fixture(autouse=True)
def _isolate_registry() -> Iterator[None]:
    saved = dict(factory_mod._REGISTRY)
    factory_mod._REGISTRY.clear()
    yield
    factory_mod._REGISTRY.clear()
    factory_mod._REGISTRY.update(saved)


class RateLimited(FakeProvider):
    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        raise RateLimitError("rate limited", provider_id=self.provider_id)


class Fatal(FakeProvider):
    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        raise ProviderError("fatal", provider_id=self.provider_id)


def test_delegates_chat() -> None:
    register("openai")(FakeProvider)
    orch = create_orchestrator({"provider": "openai", "api_key": "k"})
    res = asyncio.run(orch.chat(REQ))
    assert res.text == "chat:openai"


def test_exposes_resume_tool_on_facade() -> None:
    register("openai")(FakeProvider)
    orch = create_orchestrator({"provider": "openai", "api_key": "k"})
    res = asyncio.run(
        orch.resume_tool(REQ, [ToolResult(id="call_1", name="get_weather", content="20C")])
    )
    assert res.text == "resume:openai"
    assert res.finish_reason == "stop"


def test_failover_on_retriable() -> None:
    register("openai")(RateLimited)
    register("anthropic")(FakeProvider)
    orch = create_orchestrator(CHAIN)
    res = asyncio.run(orch.chat(REQ))
    assert res.text == "chat:anthropic"


def test_non_retriable_propagates() -> None:
    calls = {"second": False}

    class Tracking(FakeProvider):
        async def chat(self, req: ChatRequest) -> UnifiedResponse:
            calls["second"] = True
            return await super().chat(req)

    register("openai")(Fatal)
    register("anthropic")(Tracking)
    orch = create_orchestrator(CHAIN)
    with pytest.raises(ProviderError):
        asyncio.run(orch.chat(REQ))
    assert calls["second"] is False


def test_telemetry_hook() -> None:
    from llmorch_core import TelemetryContext
    from llmorch_core.models import TokenUsage

    events: list[tuple[str, str, str]] = []

    class Spy:
        def on_request_start(self, ctx: TelemetryContext) -> None:
            events.append(("start", ctx.method, ctx.provider_id))

        def on_request_end(self, ctx: TelemetryContext, usage: TokenUsage) -> None:
            events.append(("end", ctx.method, ctx.provider_id))

        def on_error(self, ctx: TelemetryContext, err: BaseException) -> None:
            events.append(("error", ctx.method, ctx.provider_id))

        def on_token(self, ctx: TelemetryContext, token: str) -> None:
            events.append(("token", ctx.method, ctx.provider_id))

    register("openai")(RateLimited)
    register("anthropic")(FakeProvider)
    orch = create_orchestrator(CHAIN, telemetry=Spy())
    asyncio.run(orch.chat(REQ))
    # Resilience exhausts retries on openai (each surfacing on_error), then the
    # orchestrator fails over and on_request_end fires for the anthropic success.
    assert ("start", "chat", "openai") in events
    assert ("error", "chat", "openai") in events
    assert ("end", "chat", "anthropic") in events
