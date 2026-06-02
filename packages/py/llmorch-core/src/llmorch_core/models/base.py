"""Shared Pydantic base: camelCase wire aliases, interchangeable with the TS Zod models."""

from pydantic import BaseModel, ConfigDict


class CamelModel(BaseModel):
    """Base model that accepts both snake_case kwargs and camelCase JSON.

    `populate_by_name` lets callers construct with Python snake_case field names,
    while `model_dump(by_alias=True)` emits the camelCase wire form the TS twin
    produces. `protected_namespaces=()` allows the `model` field on `ChatRequest`.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        extra="forbid",
        protected_namespaces=(),
    )
