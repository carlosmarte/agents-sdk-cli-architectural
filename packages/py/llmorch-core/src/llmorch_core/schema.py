"""Schema translation + validation helpers — twin of packages/ts/core/src/schema.ts.

The high-level Pydantic model is translated to a low-level JSON Schema for the
provider's native enforcement, and the provider's JSON is always validated
against the ORIGINAL model before it is returned — so constraints a provider
silently drops (e.g. Anthropic strips ``min_length`` / ``max_length`` / pattern)
are still enforced locally.
"""

from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from .errors import SchemaValidationError

T = TypeVar("T", bound=BaseModel)


def model_to_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Translate a Pydantic model to a low-level JSON Schema object."""
    return model.model_json_schema()


def parse_or_raise(model: type[T], data: Any) -> T:
    """Validate ``data`` against the ORIGINAL model, raising on failure.

    The final, provider-agnostic step of every ``generate_structured``.
    """
    try:
        return model.model_validate(data)
    except ValidationError as err:
        raise SchemaValidationError(f"Structured output failed schema validation: {err}") from err
