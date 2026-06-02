"""Anthropic structured-output test — twin of adapter-anthropic/test/structured.test.ts."""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from llmorch_adapter_anthropic import AnthropicAdapter
from llmorch_core import ProviderConfig, SchemaValidationError
from llmorch_core.models import ChatRequest, Message
from pydantic import BaseModel, Field

CFG = ProviderConfig(provider="anthropic", api_key="k")
REQ = ChatRequest(model="m", messages=[Message(role="user", content="who?")])


class Person(BaseModel):
    name: str = Field(min_length=2)
    age: int


class _Create:
    def __init__(self, tool_input: dict[str, Any]) -> None:
        self.tool_input = tool_input
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return SimpleNamespace(
            content=[SimpleNamespace(type="tool_use", name="result", input=self.tool_input)]
        )


def _adapter(create: _Create) -> AnthropicAdapter:
    adapter = AnthropicAdapter(CFG)
    adapter._cached_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    return adapter


def test_forced_tool_use_returns_validated_model() -> None:
    create = _Create({"name": "Ada", "age": 36})
    result = asyncio.run(_adapter(create).generate_structured(REQ, Person))
    assert isinstance(result, Person)
    assert result.name == "Ada"
    args = create.calls[0]
    assert args["tool_choice"] == {"type": "tool", "name": "result"}
    assert args["tools"][0]["input_schema"]["type"] == "object"


def test_enforces_original_schema_locally_even_when_anthropic_strips_constraints() -> None:
    # Anthropic drops min_length; "A" (len 1) violates it and must still fail.
    create = _Create({"name": "A", "age": 36})
    with pytest.raises(SchemaValidationError):
        asyncio.run(_adapter(create).generate_structured(REQ, Person))


def test_does_not_mutate_tool_description_between_calls() -> None:
    create = _Create({"name": "Ada", "age": 36})
    adapter = _adapter(create)
    asyncio.run(adapter.generate_structured(REQ, Person))
    asyncio.run(adapter.generate_structured(REQ, Person))
    assert create.calls[0]["tools"][0]["description"] == create.calls[1]["tools"][0]["description"]
