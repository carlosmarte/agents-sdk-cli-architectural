"""Outbound response models — twin of packages/ts/core/src/models/response.ts."""

from typing import Any, Literal

from pydantic import Field

from .base import CamelModel

FinishReason = Literal["stop", "length", "tool_use", "content_filter"]


class TokenUsage(CamelModel):
    prompt_tokens: int = Field(alias="promptTokens", ge=0)
    completion_tokens: int = Field(alias="completionTokens", ge=0)
    reasoning_tokens: int | None = Field(default=None, alias="reasoningTokens", ge=0)


class ToolInvocationRequest(CamelModel):
    id: str
    name: str
    arguments: dict[str, Any]


class ToolResult(CamelModel):
    id: str
    name: str
    content: str


class UnifiedResponse(CamelModel):
    text: str
    usage: TokenUsage
    tool_calls: list[ToolInvocationRequest] = Field(alias="toolCalls")
    finish_reason: FinishReason = Field(alias="finishReason")
