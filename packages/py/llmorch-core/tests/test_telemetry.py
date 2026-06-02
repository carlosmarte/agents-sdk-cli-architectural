"""Telemetry + context-propagation tests — twin of core/test/telemetry.test.ts.

No network. Driven with ``asyncio.run`` inside sync tests (the project does not
depend on ``pytest-asyncio``).
"""

import asyncio
from collections.abc import AsyncIterator, Iterator
from typing import Any

import llmorch_core.factory as factory_mod
import pytest
from fixtures.fake_provider import FakeProvider
from llmorch_core import (
    NoopTelemetryHook,
    Orchestrator,
    StructuredLogTelemetryHook,
    TelemetryContext,
    create_orchestrator,
    current_trace_id,
    register,
    run_with_trace,
)
from llmorch_core.errors import AuthenticationError
from llmorch_core.interface import StreamChunk
from llmorch_core.models import ChatRequest, Message, TokenUsage, UnifiedResponse

REQ = ChatRequest(model="m", messages=[Message(role="user", content="hi")])
CFG = {"provider": "openai", "api_key": "k"}


@pytest.fixture(autouse=True)
def _isolate_registry() -> Iterator[None]:
    saved = dict(factory_mod._REGISTRY)
    factory_mod._REGISTRY.clear()
    yield
    factory_mod._REGISTRY.clear()
    factory_mod._REGISTRY.update(saved)


class SpyHook:
    """Records call order plus what each callback observed."""

    def __init__(self) -> None:
        self.events: list[str] = []
        self.end_usage: TokenUsage | None = None
        self.start_trace_id: str | None = None

    def on_request_start(self, ctx: TelemetryContext) -> None:
        self.events.append("start")
        self.start_trace_id = ctx.trace_id

    def on_request_end(self, ctx: TelemetryContext, usage: TokenUsage) -> None:
        self.events.append("end")
        self.end_usage = usage

    def on_error(self, ctx: TelemetryContext, err: BaseException) -> None:
        self.events.append("error")

    def on_token(self, ctx: TelemetryContext, token: str) -> None:
        self.events.append("token")


def test_start_then_end_with_usage_on_success() -> None:
    register("openai")(FakeProvider)
    hook = SpyHook()
    orch = create_orchestrator(CFG, telemetry=hook)
    asyncio.run(orch.chat(REQ))
    assert hook.events == ["start", "end"]
    assert hook.end_usage == TokenUsage(prompt_tokens=1, completion_tokens=1)


def test_start_then_error_no_end_on_failure() -> None:
    class Failing(FakeProvider):
        async def chat(self, req: ChatRequest) -> UnifiedResponse:
            raise AuthenticationError("nope", provider_id=self.provider_id)

    register("openai")(Failing)
    hook = SpyHook()
    orch = create_orchestrator(CFG, telemetry=hook)
    with pytest.raises(AuthenticationError):
        asyncio.run(orch.chat(REQ))
    assert hook.events == ["start", "error"]


def test_on_token_per_chunk_between_start_and_end() -> None:
    class Streaming(FakeProvider):
        async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
            yield StreamChunk(delta="a")
            yield StreamChunk(
                delta="b",
                usage=TokenUsage(prompt_tokens=2, completion_tokens=3),
                finish_reason="stop",
            )

    register("openai")(Streaming)
    hook = SpyHook()
    orch = create_orchestrator(CFG, telemetry=hook)

    async def drain() -> None:
        async for _chunk in orch.stream(REQ):
            pass

    asyncio.run(drain())
    assert hook.events == ["start", "token", "token", "end"]
    assert hook.end_usage == TokenUsage(prompt_tokens=2, completion_tokens=3)


def test_trace_id_visible_to_nested_call_and_hook() -> None:
    class TraceReading(FakeProvider):
        async def chat(self, req: ChatRequest) -> UnifiedResponse:
            # No trace_id parameter — read it from the ambient ContextVar.
            return UnifiedResponse(
                text=current_trace_id() or "<none>",
                usage=TokenUsage(prompt_tokens=1, completion_tokens=1),
                tool_calls=[],
                finish_reason="stop",
            )

    register("openai")(TraceReading)
    hook = SpyHook()
    orch = create_orchestrator(CFG, telemetry=hook)
    res = asyncio.run(orch.chat(REQ))
    assert res.text == hook.start_trace_id
    assert res.text != "<none>"


def test_trace_ids_isolated_across_concurrent_tasks() -> None:
    class TraceReading(FakeProvider):
        async def chat(self, req: ChatRequest) -> UnifiedResponse:
            return UnifiedResponse(
                text=current_trace_id() or "<none>",
                usage=TokenUsage(prompt_tokens=1, completion_tokens=1),
                tool_calls=[],
                finish_reason="stop",
            )

    register("openai")(TraceReading)
    hook_a = SpyHook()
    hook_b = SpyHook()
    orch_a = create_orchestrator(CFG, telemetry=hook_a)
    orch_b = create_orchestrator(CFG, telemetry=hook_b)

    async def call(orch: Orchestrator, trace_id: str) -> UnifiedResponse:
        # Each task copies the context; setting it here stays task-local.
        with run_with_trace(trace_id):
            return await orch.chat(REQ)

    async def both() -> tuple[UnifiedResponse, UnifiedResponse]:
        return await asyncio.gather(call(orch_a, "trace-A"), call(orch_b, "trace-B"))

    a, b = asyncio.run(both())
    assert a.text == "trace-A"
    assert b.text == "trace-B"
    assert hook_a.start_trace_id == "trace-A"
    assert hook_b.start_trace_id == "trace-B"


def test_noop_default_completes_without_output(capsys: pytest.CaptureFixture[str]) -> None:
    register("openai")(FakeProvider)
    orch = create_orchestrator(CFG)  # no hook → NoopTelemetryHook
    res = asyncio.run(orch.chat(REQ))
    assert res.text == "chat:openai"
    assert capsys.readouterr().out == ""


def test_structured_log_hook_emits_and_never_throws() -> None:
    recs: list[dict[str, Any]] = []
    hook = StructuredLogTelemetryHook(log=recs.append)
    ctx = TelemetryContext(trace_id="t", provider_id="openai", method="chat")
    hook.on_request_start(ctx)
    hook.on_request_end(ctx, TokenUsage(prompt_tokens=1, completion_tokens=2))
    hook.on_error(ctx, RuntimeError("boom"))
    hook.on_token(ctx, "x")
    assert len(recs) == 4
    assert recs[0]["event"] == "request.start"
    assert recs[0]["trace_id"] == "t"

    def boom(_r: dict[str, Any]) -> None:
        raise RuntimeError("sink down")

    throwing = StructuredLogTelemetryHook(log=boom)
    throwing.on_request_start(ctx)  # swallowed, no raise

    # The no-op default is callable and silent.
    NoopTelemetryHook().on_request_start(ctx)
