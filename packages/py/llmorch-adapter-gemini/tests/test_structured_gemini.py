"""Gemini structured-output test — twin of adapter-gemini/test/structured.test.ts.

Also asserts the Python-specific ``process_schema`` preprocess runs (to inline
``$ref`` in nested models) — the seam is monkeypatched so no real google-genai
import is needed.
"""

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import llmorch_adapter_gemini as gem_mod
from llmorch_adapter_gemini import GeminiAdapter
from llmorch_core import ProviderConfig
from llmorch_core.models import ChatRequest, Message
from pydantic import BaseModel, Field

CFG = ProviderConfig(provider="gemini", api_key="k")
REQ = ChatRequest(model="m", messages=[Message(role="user", content="who?")])


class Address(BaseModel):
    city: str


class Person(BaseModel):
    name: str = Field(min_length=2)
    age: int
    address: Address  # nested model → produces a $ref in the JSON schema


class _Create:
    def __init__(self, content: str) -> None:
        self.content = content
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return SimpleNamespace(text=self.content)


def test_sets_response_schema_and_runs_process_schema(monkeypatch: Any) -> None:
    seen: dict[str, Any] = {}

    def _spy(schema: dict[str, Any]) -> dict[str, Any]:
        seen["schema"] = schema
        # Pretend $ref inlining happened.
        return {**schema, "_processed": True}

    monkeypatch.setattr(gem_mod, "_process_schema", _spy)

    create = _Create(json.dumps({"name": "Ada", "age": 36, "address": {"city": "Paris"}}))
    adapter = GeminiAdapter(CFG)
    adapter._cached_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=create))
    )

    result = asyncio.run(adapter.generate_structured(REQ, Person))
    assert isinstance(result, Person)
    assert result.address.city == "Paris"

    # process_schema was invoked on a schema that contained nested-model $defs.
    assert "schema" in seen
    assert "$defs" in seen["schema"]

    config = create.calls[0]["config"]
    assert config["response_mime_type"] == "application/json"
    assert config["response_schema"]["_processed"] is True


def _refs(node: Any) -> list[str]:
    """Collect every ``$ref`` string anywhere in a JSON-schema-shaped structure."""
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                found.append(value)
            else:
                found.extend(_refs(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(_refs(value))
    return found


def test_process_schema_inlines_nested_ref_unmocked() -> None:
    """Non-mocked: a real Pydantic nested-model schema has its ``$ref`` inlined.

    The mocked test above proves the seam is *invoked*; this proves the actual
    inliner *works* — distinct from ``test_sets_response_schema_and_runs_process_schema``.
    """
    raw = Person.model_json_schema()
    # Sanity: Pydantic really did emit a $ref into a $defs table for `address`.
    assert "$defs" in raw
    assert _refs(raw), "expected the raw Pydantic schema to contain a $ref"

    processed = gem_mod._process_schema(raw)

    # No $ref / $defs survive — Gemini's response_schema is self-contained.
    assert _refs(processed) == []
    assert "$defs" not in processed
    # The nested model was inlined in place: address → object with a `city` property.
    address = processed["properties"]["address"]
    assert address["type"] == "object"
    assert "city" in address["properties"]
