"""The unified provider interface — twin of packages/ts/core/src/interface.ts.

Provides a nominal `abc.ABC` (for subclassing + the "incomplete subclass raises
TypeError" guarantee) and a structural `typing.Protocol` so duck-typed
implementations also type-check.
"""

import abc
from collections.abc import AsyncIterator
from typing import Protocol, TypeVar, runtime_checkable

from pydantic import BaseModel, Field

from .models import (
    ChatRequest,
    FinishReason,
    TokenUsage,
    ToolInvocationRequest,
    ToolResult,
    UnifiedResponse,
)
from .models.base import CamelModel


class StreamChunk(CamelModel):
    """An incremental piece of a streamed response."""

    delta: str
    tool_call_delta: ToolInvocationRequest | None = Field(default=None, alias="toolCallDelta")
    usage: TokenUsage | None = None
    finish_reason: FinishReason | None = Field(default=None, alias="finishReason")


# Structured-output schemas are Pydantic model classes.
T = TypeVar("T", bound=BaseModel)


class LLMProvider(abc.ABC):
    """Nominal base every adapter subclasses."""

    provider_id: str

    @abc.abstractmethod
    async def chat(self, req: ChatRequest) -> UnifiedResponse: ...

    @abc.abstractmethod
    def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]: ...

    @abc.abstractmethod
    async def generate_structured(self, req: ChatRequest, schema: type[T]) -> T: ...

    @abc.abstractmethod
    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse: ...

    @abc.abstractmethod
    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse: ...


@runtime_checkable
class LLMProviderProtocol(Protocol):
    """Structural mirror of {@link LLMProvider} for duck-typed implementations."""

    provider_id: str

    async def chat(self, req: ChatRequest) -> UnifiedResponse: ...

    def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]: ...

    async def generate_structured(self, req: ChatRequest, schema: type[T]) -> T: ...

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse: ...

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse: ...
