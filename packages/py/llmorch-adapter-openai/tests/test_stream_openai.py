"""OpenAI streaming test — twin of adapter-openai/test/stream.test.ts."""

import asyncio
from types import SimpleNamespace
from typing import Any

from llmorch_adapter_openai import OpenAIAdapter
from llmorch_core import ProviderConfig
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="openai", api_key="k")
REQ = ChatRequest(model="m", messages=[Message(role="user", content="hi")])

CHUNKS = [
    SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content="Hel"), finish_reason=None)],
        usage=None,
    ),
    SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content="lo"), finish_reason=None)],
        usage=None,
    ),
    SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content="!"), finish_reason="stop")],
        usage=SimpleNamespace(prompt_tokens=3, completion_tokens=5),
    ),
]


async def _aiter(items: list[Any]) -> Any:
    for i in items:
        yield i


class _StreamCreate:
    def __init__(self, chunks: list[Any]) -> None:
        self.chunks = chunks
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return _aiter(self.chunks)


def _adapter(create: _StreamCreate) -> OpenAIAdapter:
    adapter = OpenAIAdapter(CFG)
    adapter._cached_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    return adapter


def _collect(adapter: OpenAIAdapter) -> list[Any]:
    async def run() -> list[Any]:
        return [c async for c in adapter.stream(REQ)]

    return asyncio.run(run())


def test_emits_deltas_then_one_terminal_usage_chunk() -> None:
    create = _StreamCreate(CHUNKS)
    chunks = _collect(_adapter(create))
    assert create.calls[0]["stream"] is True
    assert "".join(c.delta for c in chunks if c.delta != "") == "Hello!"
    terminal = chunks[-1]
    assert terminal.delta == ""
    assert terminal.usage is not None
    assert terminal.usage.prompt_tokens == 3
    assert terminal.usage.completion_tokens == 5
    assert terminal.finish_reason == "stop"
