"""Copilot structured-output test — twin of adapter-copilot/test/structured.test.ts.

The CLI has no strict JSON-schema mode, so the adapter embeds the schema in the
prompt and parses/validates the reply (tolerating a fenced ```json block).
"""

import asyncio
import json
from collections.abc import AsyncIterator

from llmorch_adapter_copilot import CopilotAdapter
from llmorch_core import ProviderConfig
from llmorch_core.models import ChatRequest, Message
from pydantic import BaseModel, Field

CFG = ProviderConfig(provider="copilot", api_key="k")
REQ = ChatRequest(model="m", messages=[Message(role="user", content="who?")])


class Person(BaseModel):
    name: str = Field(min_length=2)
    age: int


def _adapter(content: str):
    prompts: list[str] = []

    async def run(prompt: str) -> AsyncIterator[str]:
        prompts.append(prompt)
        yield content

    adapter = CopilotAdapter(CFG)
    adapter._runner = run
    return adapter, prompts


def test_embeds_schema_in_prompt_and_parses_reply() -> None:
    adapter, prompts = _adapter(json.dumps({"name": "Ada", "age": 36}))
    result = asyncio.run(adapter.generate_structured(REQ, Person))
    assert isinstance(result, Person)
    assert result.name == "Ada"
    assert "JSON Schema" in prompts[0]


def test_tolerates_fenced_json_block() -> None:
    adapter, _ = _adapter('Here you go:\n```json\n{"name": "Ada", "age": 36}\n```\n')
    result = asyncio.run(adapter.generate_structured(REQ, Person))
    assert result.age == 36
