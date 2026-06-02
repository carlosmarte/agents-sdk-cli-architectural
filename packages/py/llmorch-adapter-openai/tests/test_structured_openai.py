"""OpenAI structured-output test — twin of adapter-openai/test/structured.test.ts."""

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest
from llmorch_adapter_openai import OpenAIAdapter
from llmorch_core import ProviderConfig, SchemaValidationError
from llmorch_core.models import ChatRequest, Message
from pydantic import BaseModel, Field

CFG = ProviderConfig(provider="openai", api_key="k")
REQ = ChatRequest(model="m", messages=[Message(role="user", content="who?")])


class Person(BaseModel):
    name: str = Field(min_length=2)
    age: int


class _Create:
    def __init__(self, content: str) -> None:
        self.content = content
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )


def _adapter(create: _Create) -> OpenAIAdapter:
    adapter = OpenAIAdapter(CFG)
    adapter._cached_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    return adapter


def test_returns_validated_model_and_sends_strict_json_schema() -> None:
    create = _Create(json.dumps({"name": "Ada", "age": 36}))
    result = asyncio.run(_adapter(create).generate_structured(REQ, Person))
    assert isinstance(result, Person)
    assert result.name == "Ada"
    rf = create.calls[0]["response_format"]
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["strict"] is True
    assert rf["json_schema"]["schema"]["type"] == "object"


def test_raises_when_returned_json_violates_schema() -> None:
    create = _Create(json.dumps({"name": "A", "age": 36}))
    with pytest.raises(SchemaValidationError):
        asyncio.run(_adapter(create).generate_structured(REQ, Person))
