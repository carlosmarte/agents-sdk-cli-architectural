"""Cross-language contract suite mirroring the TS provider-contract.test.ts."""

import asyncio

from llmorch_core.interface import LLMProviderProtocol, StreamChunk
from llmorch_core.models import ChatRequest, Message, ToolDefinition, ToolResult
from llmorch_core.testing import FakeProvider
from pydantic import BaseModel

REQ = ChatRequest(model="fake-1", messages=[Message(role="user", content="hi")])


async def _collect(provider: FakeProvider) -> list[StreamChunk]:
    return [chunk async for chunk in provider.stream(REQ)]


def test_provider_satisfies_protocol() -> None:
    assert isinstance(FakeProvider(), LLMProviderProtocol)


def test_chat_returns_unified_response_stop() -> None:
    res = asyncio.run(FakeProvider().chat(REQ))
    assert res.finish_reason == "stop"


def test_stream_concatenates_to_chat_text() -> None:
    provider = FakeProvider()
    full = asyncio.run(provider.chat(REQ)).text
    chunks = asyncio.run(_collect(provider))
    assert len(chunks) >= 1
    assert "".join(c.delta for c in chunks) == full
    assert any(c.finish_reason is not None for c in chunks)


def test_generate_structured_returns_schema_valid_object() -> None:
    class Answer(BaseModel):
        answer: str

    provider = FakeProvider(structured={"answer": "42"})
    out = asyncio.run(provider.generate_structured(REQ, Answer))
    assert out.answer == "42"


def test_invoke_tool_returns_tool_calls() -> None:
    req = ChatRequest(
        model="fake-1",
        messages=[Message(role="user", content="hi")],
        tools=[ToolDefinition(name="lookup", description="d", parameters={})],
    )
    res = asyncio.run(FakeProvider().invoke_tool(req))
    assert len(res.tool_calls) >= 1
    assert res.finish_reason == "tool_use"


def test_halt_then_resume_loop() -> None:
    req = ChatRequest(
        model="fake-1",
        messages=[Message(role="user", content="hi")],
        tools=[ToolDefinition(name="lookup", description="d", parameters={})],
    )
    provider = FakeProvider()
    halt = asyncio.run(provider.invoke_tool(req))
    assert halt.finish_reason == "tool_use"
    call = halt.tool_calls[0]
    resumed = asyncio.run(
        provider.resume_tool(
            REQ, [ToolResult(id=call.id, name=call.name, content="result-payload")]
        )
    )
    assert resumed.finish_reason == "stop"
    assert "result-payload" in resumed.text
