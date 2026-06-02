import pytest
from llmorch_core.models import (
    ChatRequest,
    Message,
    NamedToolChoice,
    TextBlock,
    ToolDefinition,
    ToolResultBlock,
)
from pydantic import ValidationError


def test_message_string_content() -> None:
    msg = Message(role="user", content="hello")
    assert msg.content == "hello"


def test_message_block_array_content() -> None:
    msg = Message(
        role="assistant",
        content=[
            TextBlock(type="text", text="hi"),
            ToolResultBlock(type="tool_result", tool_call_id="call_1", content="42"),
        ],
    )
    assert isinstance(msg.content, list)


def test_chat_request_round_trip_by_alias() -> None:
    req = ChatRequest(
        model="gpt-x",
        messages=[Message(role="user", content="hello")],
        temperature=0.7,
        max_tokens=256,
        reasoning_effort="medium",
        tools=[ToolDefinition(name="echo", description="echoes", parameters={"type": "object"})],
        tool_choice=NamedToolChoice(type="tool", name="echo"),
        response_schema={"type": "object"},
    )
    dumped = req.model_dump_json(by_alias=True)
    assert ChatRequest.model_validate_json(dumped) == req
    keys = req.model_dump(by_alias=True).keys()
    assert "maxTokens" in keys
    assert "toolChoice" in keys


def test_invalid_role() -> None:
    with pytest.raises(ValidationError):
        Message(role="bogus", content="x")


def test_temperature_out_of_range() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(model="m", messages=[], temperature=5)


def test_missing_model() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(messages=[])  # type: ignore[call-arg]
