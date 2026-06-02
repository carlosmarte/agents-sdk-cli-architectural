"""Anthropic SSE state-machine test — twin of adapter-anthropic/test/stream.test.ts."""

import asyncio
from types import SimpleNamespace
from typing import Any

from llmorch_adapter_anthropic.stream import anthropic_sse_to_chunks

LIFECYCLE = [
    SimpleNamespace(
        type="message_start",
        message=SimpleNamespace(usage=SimpleNamespace(input_tokens=10, output_tokens=0)),
    ),
    SimpleNamespace(type="content_block_start"),
    SimpleNamespace(
        type="content_block_delta", delta=SimpleNamespace(type="text_delta", text="Hel")
    ),
    SimpleNamespace(
        type="content_block_delta", delta=SimpleNamespace(type="text_delta", text="lo")
    ),
    SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type="text_delta", text="!")),
    SimpleNamespace(type="content_block_stop"),
    SimpleNamespace(
        type="message_delta",
        delta=SimpleNamespace(stop_reason="end_turn"),
        usage=SimpleNamespace(output_tokens=5),
    ),
    SimpleNamespace(type="message_stop"),
]


def _collect(events: list[Any]) -> list[Any]:
    async def run() -> list[Any]:
        return [chunk async for chunk in anthropic_sse_to_chunks(events)]

    return asyncio.run(run())


def test_surfaces_only_text_deltas_filtering_structural_events() -> None:
    chunks = _collect(LIFECYCLE)
    # 3 text deltas + exactly 1 terminal chunk — structural events yield nothing.
    assert len(chunks) == 4
    assert [c.delta for c in chunks if c.delta != ""] == ["Hel", "lo", "!"]


def test_single_terminal_chunk_carries_merged_usage_and_finish() -> None:
    chunks = _collect(LIFECYCLE)
    terminal = chunks[-1]
    assert terminal.delta == ""
    assert terminal.usage is not None
    assert terminal.usage.prompt_tokens == 10
    assert terminal.usage.completion_tokens == 5
    assert terminal.finish_reason == "stop"
    # No earlier chunk carries usage/finish_reason.
    assert all(c.usage is None and c.finish_reason is None for c in chunks[:-1])


def test_deltas_reconstruct_full_text() -> None:
    assert "".join(c.delta for c in _collect(LIFECYCLE)) == "Hello!"
