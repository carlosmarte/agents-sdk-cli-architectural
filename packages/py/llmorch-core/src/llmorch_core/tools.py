"""Tool-definition translators — twin of packages/ts/core/src/tools.ts.

The application defines tools once as :class:`ToolDefinition`; each adapter
translates them into the proprietary shape its SDK expects. The manual
halt->resume loop lives in the adapters; this module owns only the (pure,
testable) translation.
"""

from typing import Any

from .models import ToolDefinition


def to_openai_tools(defs: list[ToolDefinition]) -> list[dict[str, Any]]:
    """OpenAI / Copilot function-tool array."""
    return [
        {
            "type": "function",
            "function": {
                "name": d.name,
                "description": d.description,
                "parameters": d.parameters,
            },
        }
        for d in defs
    ]


def to_anthropic_tools(defs: list[ToolDefinition]) -> list[dict[str, Any]]:
    """Anthropic tools: a flat array with ``input_schema``."""
    return [
        {"name": d.name, "description": d.description, "input_schema": d.parameters} for d in defs
    ]


def to_gemini_tools(defs: list[ToolDefinition]) -> list[dict[str, Any]]:
    """Gemini tools: a single entry holding ``function_declarations``."""
    return [
        {
            "function_declarations": [
                {"name": d.name, "description": d.description, "parameters": d.parameters}
                for d in defs
            ]
        }
    ]
