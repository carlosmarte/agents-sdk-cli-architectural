"""In-memory FakeProvider — twin of packages/ts/core/src/testing/fake-provider.ts.

Deterministic canned responses, no network, no provider SDK. Proves the
interface is implementable and is the reusable fixture later features test against.
"""

from collections.abc import AsyncIterator
from typing import TypeVar

from pydantic import BaseModel

from ..interface import LLMProvider, StreamChunk
from ..models import (
    ChatRequest,
    TokenUsage,
    ToolInvocationRequest,
    ToolResult,
    UnifiedResponse,
)

T = TypeVar("T", bound=BaseModel)

DEFAULT_TEXT = "Hello from the fake provider."


class FakeProvider(LLMProvider):
    provider_id = "fake"

    def __init__(
        self,
        *,
        text: str = DEFAULT_TEXT,
        tool_calls: list[ToolInvocationRequest] | None = None,
        usage: TokenUsage | None = None,
        chunks: list[StreamChunk] | None = None,
        structured: object | None = None,
    ) -> None:
        self._text = text
        self._tool_calls = tool_calls or []
        self._usage = usage or TokenUsage(prompt_tokens=1, completion_tokens=1)
        self._structured: object = {} if structured is None else structured
        self._chunks = chunks if chunks is not None else self._default_chunks()

    def _default_chunks(self) -> list[StreamChunk]:
        mid = (len(self._text) + 1) // 2
        return [
            StreamChunk(delta=self._text[:mid]),
            StreamChunk(delta=self._text[mid:], usage=self._usage, finish_reason="stop"),
        ]

    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        return UnifiedResponse(
            text=self._text,
            usage=self._usage,
            tool_calls=[],
            finish_reason="stop",
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        for chunk in self._chunks:
            yield chunk

    async def generate_structured(self, req: ChatRequest, schema: type[T]) -> T:
        return schema.model_validate(self._structured)

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse:
        tool_calls = self._tool_calls or [
            ToolInvocationRequest(
                id="call_1",
                name=req.tools[0].name if req.tools else "echo",
                arguments={},
            )
        ]
        return UnifiedResponse(
            text="",
            usage=self._usage,
            tool_calls=tool_calls,
            finish_reason="tool_use",
        )

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse:
        """Deterministic final answer echoing the supplied results — mirrors how a
        real adapter resumes to a ``finish_reason="stop"`` response once the host
        hands tool output back."""
        summary = ", ".join(f"{r.name}={r.content}" for r in results)
        return UnifiedResponse(
            text=f"Resumed with {summary}." if summary else self._text,
            usage=self._usage,
            tool_calls=[],
            finish_reason="stop",
        )
