"""Inbound request models — twin of packages/ts/core/src/models/request.ts."""

from typing import Any, Literal

from pydantic import Field

from .base import CamelModel
from .messages import Message

ReasoningEffort = Literal["low", "medium", "high"]


class ToolDefinition(CamelModel):
    name: str
    description: str
    parameters: dict[str, Any]


class NamedToolChoice(CamelModel):
    type: Literal["tool"]
    name: str


ToolChoice = Literal["auto", "none", "required"] | NamedToolChoice


class ChatRequest(CamelModel):
    model: str
    messages: list[Message]
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, alias="maxTokens", gt=0)
    reasoning_effort: ReasoningEffort | None = Field(default=None, alias="reasoningEffort")
    tools: list[ToolDefinition] | None = None
    tool_choice: ToolChoice | None = Field(default=None, alias="toolChoice")
    response_schema: dict[str, Any] | None = Field(default=None, alias="responseSchema")
