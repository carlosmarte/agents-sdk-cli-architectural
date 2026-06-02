"""Minimal JSON-Schema → Pydantic model builder — twin of schema-bridge.ts.

The orchestrator's ``generate_structured`` validates output against a Pydantic
model class, but the CLI accepts a JSON Schema file from ``--schema``; this is the
bridge. It covers the same subset as ``llmorch_core``'s ``model_to_json_schema``
(object/string/number/integer/boolean/array + ``required``) and is dependency-free
in line with the repo's zero-extra-runtime-deps policy.
"""

from typing import Any

from pydantic import BaseModel, create_model

_JSON_TO_PY: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _type_for(node: dict[str, Any]) -> Any:
    kind = node.get("type")
    if kind == "object":
        return json_schema_to_model(node)
    if kind == "array":
        items = node.get("items")
        return list[_type_for(items)] if isinstance(items, dict) else list  # type: ignore[misc]
    return _JSON_TO_PY.get(kind, Any) if isinstance(kind, str) else Any


def json_schema_to_model(schema: dict[str, Any], name: str = "StructuredOutput") -> type[BaseModel]:
    """Build a Pydantic model class from a (subset of) JSON Schema object."""
    properties: dict[str, Any] = schema.get("properties", {})
    required = set(schema.get("required", []))
    fields: dict[str, Any] = {}
    for key, sub in properties.items():
        py_type = _type_for(sub)
        if key in required:
            fields[key] = (py_type, ...)
        else:
            fields[key] = (py_type | None, None)
    return create_model(name, **fields)
