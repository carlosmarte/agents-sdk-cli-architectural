"""Anthropic streaming state machine — twin of packages/ts/adapter-anthropic/src/stream.ts.

The Anthropic stream is a multi-event lifecycle, not a flat delta stream::

    message_start -> content_block_start -> content_block_delta* ->
    content_block_stop -> message_delta -> message_stop

The generated text lives ONLY in ``content_block_delta`` events (``delta.text``).
This machine surfaces just those text deltas, filters every structural event, and
closes with exactly one terminal chunk carrying the merged usage + finish reason.
Isolated here so the lifecycle handling is independently testable.
"""

from collections.abc import AsyncIterator, Iterable
from typing import Any

from llmorch_core import FinishReason, StreamChunk, TokenUsage


def _map_stop_reason(reason: str | None) -> FinishReason:
    if reason == "max_tokens":
        return "length"
    if reason == "tool_use":
        return "tool_use"
    return "stop"


def _merge_usage(current: TokenUsage | None, fragment: Any) -> TokenUsage:
    """Fold a usage fragment into the running total (each event carries a subset)."""
    return TokenUsage(
        prompt_tokens=getattr(fragment, "input_tokens", None)
        or (current.prompt_tokens if current else 0)
        or 0,
        completion_tokens=getattr(fragment, "output_tokens", None)
        or (current.completion_tokens if current else 0)
        or 0,
    )


async def _aiter(events: AsyncIterator[Any] | Iterable[Any]) -> AsyncIterator[Any]:
    """Accept either a sync or async iterable of events."""
    if isinstance(events, AsyncIterator):
        async for ev in events:
            yield ev
        return
    for ev in events:
        yield ev


async def anthropic_sse_to_chunks(
    events: AsyncIterator[Any] | Iterable[Any],
) -> AsyncIterator[StreamChunk]:
    """Transform an Anthropic SSE lifecycle into the normalized StreamChunk sequence."""
    usage: TokenUsage | None = None
    finish_reason: FinishReason | None = None

    async for ev in _aiter(events):
        kind = getattr(ev, "type", None)
        if kind == "content_block_delta":
            delta = getattr(ev, "delta", None)
            text = getattr(delta, "text", None)
            if getattr(delta, "type", None) == "text_delta" and text:
                yield StreamChunk(delta=text)
        elif kind == "message_start":
            usage = _merge_usage(usage, getattr(getattr(ev, "message", None), "usage", None))
        elif kind == "message_delta":
            usage = _merge_usage(usage, getattr(ev, "usage", None))
            stop_reason = getattr(getattr(ev, "delta", None), "stop_reason", None)
            if stop_reason:
                finish_reason = _map_stop_reason(stop_reason)
        # content_block_start / content_block_stop / message_stop are structural.

    yield StreamChunk(
        delta="",
        usage=usage or TokenUsage(prompt_tokens=0, completion_tokens=0),
        finish_reason=finish_reason or "stop",
    )
