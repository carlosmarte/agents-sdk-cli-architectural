"""Schema helper test — twin of core/test/schema.test.ts."""

import pytest
from llmorch_core import SchemaValidationError
from llmorch_core.schema import model_to_json_schema, parse_or_raise
from pydantic import BaseModel, Field


class Person(BaseModel):
    name: str = Field(min_length=2)
    age: int


def test_model_to_json_schema_emits_object_with_properties() -> None:
    js = model_to_json_schema(Person)
    assert js["type"] == "object"
    assert "name" in js["properties"]
    assert js["properties"]["age"]["type"] == "integer"


def test_parse_or_raise_returns_validated_instance() -> None:
    person = parse_or_raise(Person, {"name": "Ada", "age": 36})
    assert isinstance(person, Person)
    assert person.name == "Ada"
    assert person.age == 36


def test_parse_or_raise_raises_on_constraint_violation() -> None:
    with pytest.raises(SchemaValidationError):
        parse_or_raise(Person, {"name": "A", "age": 36})
