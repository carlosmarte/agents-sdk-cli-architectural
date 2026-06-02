"""Inbound message models — twin of packages/ts/core/src/models/messages.ts."""

from typing import Annotated, Literal

from pydantic import Field

from .base import CamelModel

Role = Literal["system", "user", "assistant", "tool"]


class TextBlock(CamelModel):
    type: Literal["text"]
    text: str


class ToolResultBlock(CamelModel):
    type: Literal["tool_result"]
    tool_call_id: str = Field(alias="toolCallId")
    content: str


ContentBlock = Annotated[TextBlock | ToolResultBlock, Field(discriminator="type")]


class Message(CamelModel):
    role: Role
    content: str | list[ContentBlock]
