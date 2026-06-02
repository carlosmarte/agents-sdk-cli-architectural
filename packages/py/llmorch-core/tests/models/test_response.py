import pytest
from llmorch_core.models import (
    TokenUsage,
    ToolInvocationRequest,
    UnifiedResponse,
)
from pydantic import ValidationError


def test_empty_tool_calls_stop() -> None:
    res = UnifiedResponse(
        text="done",
        usage=TokenUsage(prompt_tokens=1, completion_tokens=2),
        tool_calls=[],
        finish_reason="stop",
    )
    assert res.tool_calls == []


def test_populated_tool_calls_tool_use() -> None:
    res = UnifiedResponse(
        text="",
        usage=TokenUsage(prompt_tokens=1, completion_tokens=0),
        tool_calls=[ToolInvocationRequest(id="call_1", name="echo", arguments={"x": 1})],
        finish_reason="tool_use",
    )
    assert res.finish_reason == "tool_use"
    assert len(res.tool_calls) == 1


def test_round_trip_by_alias() -> None:
    res = UnifiedResponse(
        text="answer",
        usage=TokenUsage(prompt_tokens=3, completion_tokens=4, reasoning_tokens=5),
        tool_calls=[ToolInvocationRequest(id="c1", name="t", arguments={})],
        finish_reason="length",
    )
    dumped = res.model_dump_json(by_alias=True)
    assert UnifiedResponse.model_validate_json(dumped) == res
    keys = res.model_dump(by_alias=True).keys()
    assert "toolCalls" in keys
    assert "finishReason" in keys


def test_reasoning_tokens_optional() -> None:
    usage = TokenUsage(prompt_tokens=1, completion_tokens=1)
    assert usage.reasoning_tokens is None


def test_invalid_finish_reason() -> None:
    with pytest.raises(ValidationError):
        UnifiedResponse(
            text="x",
            usage=TokenUsage(prompt_tokens=0, completion_tokens=0),
            tool_calls=[],
            finish_reason="explode",
        )
