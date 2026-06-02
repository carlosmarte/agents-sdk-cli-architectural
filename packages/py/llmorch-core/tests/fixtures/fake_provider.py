"""Shared factory/orchestrator test double — twin of test/fixtures/fake-provider.ts."""

from collections.abc import AsyncIterator
from typing import TypeVar

from llmorch_core.config import ProviderConfig
from llmorch_core.interface import LLMProvider, StreamChunk
from llmorch_core.models import (
    ChatRequest,
    TokenUsage,
    ToolInvocationRequest,
    ToolResult,
    UnifiedResponse,
)
from pydantic import BaseModel

M = TypeVar("M", bound=BaseModel)


class FakeProvider(LLMProvider):
    """Records the ProviderConfig; returns deterministic responses keyed by id."""

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self.provider_id = config.provider

    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        return UnifiedResponse(
            text=f"chat:{self.provider_id}",
            usage=TokenUsage(prompt_tokens=1, completion_tokens=1),
            tool_calls=[],
            finish_reason="stop",
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        yield StreamChunk(delta=f"chat:{self.provider_id}", finish_reason="stop")

    async def generate_structured(self, req: ChatRequest, schema: type[M]) -> M:
        return schema.model_validate({})

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse:
        return UnifiedResponse(
            text="",
            usage=TokenUsage(prompt_tokens=1, completion_tokens=1),
            tool_calls=[ToolInvocationRequest(id="call_1", name="echo", arguments={})],
            finish_reason="tool_use",
        )

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse:
        return UnifiedResponse(
            text=f"resume:{self.provider_id}",
            usage=TokenUsage(prompt_tokens=1, completion_tokens=1),
            tool_calls=[],
            finish_reason="stop",
        )
