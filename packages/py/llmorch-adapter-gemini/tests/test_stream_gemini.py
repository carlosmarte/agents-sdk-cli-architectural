"""Gemini streaming test — twin of adapter-gemini/test/stream.test.ts."""

import asyncio
from types import SimpleNamespace
from typing import Any

from llmorch_adapter_gemini import GeminiAdapter
from llmorch_core import ProviderConfig
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="gemini", api_key="k")
REQ = ChatRequest(model="m", messages=[Message(role="user", content="hi")])

CHUNKS = [
    SimpleNamespace(text="Hel", usage_metadata=None, candidates=None),
    SimpleNamespace(text="lo", usage_metadata=None, candidates=None),
    SimpleNamespace(
        text="!",
        usage_metadata=SimpleNamespace(prompt_token_count=3, candidates_token_count=5),
        candidates=[SimpleNamespace(finish_reason="STOP")],
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


def test_emits_deltas_then_terminal_usage_stateless() -> None:
    create = _StreamCreate(CHUNKS)
    chats_called = {"n": 0}

    async def _chats(**_kwargs: Any) -> Any:  # pragma: no cover — must never run
        chats_called["n"] += 1

    adapter = GeminiAdapter(CFG)
    adapter._cached_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=create)),
        chats=SimpleNamespace(create=_chats),
    )

    async def run() -> list[Any]:
        return [c async for c in adapter.stream(REQ)]

    chunks = asyncio.run(run())
    assert "".join(c.delta for c in chunks if c.delta != "") == "Hello!"
    terminal = chunks[-1]
    assert terminal.delta == ""
    assert terminal.usage is not None
    assert terminal.usage.prompt_tokens == 3
    assert terminal.usage.completion_tokens == 5
    assert terminal.finish_reason == "stop"
    assert chats_called["n"] == 0  # stateless streaming path
