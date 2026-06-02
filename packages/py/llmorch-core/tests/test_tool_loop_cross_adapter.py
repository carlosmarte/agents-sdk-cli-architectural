"""Cross-adapter tool-loop parity — twin of core/test/tool-loop-cross-adapter.test.ts."""

import asyncio
import json
from types import SimpleNamespace
from typing import Any

from llmorch_adapter_anthropic import AnthropicAdapter
from llmorch_adapter_copilot import CopilotAdapter
from llmorch_adapter_gemini import GeminiAdapter
from llmorch_adapter_openai import OpenAIAdapter
from llmorch_core import ProviderConfig
from llmorch_core.models import (
    ChatRequest,
    Message,
    NamedToolChoice,
    ToolDefinition,
    ToolResult,
)

CFG = ProviderConfig(provider="openai", api_key="k")
WEATHER = ToolDefinition(
    name="get_weather",
    description="Get the weather for a city.",
    parameters={"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
)
REQ = ChatRequest(
    model="m",
    messages=[Message(role="user", content="weather in Paris?")],
    tools=[WEATHER],
    tool_choice=NamedToolChoice(type="tool", name="get_weather"),
)


class _Seq:
    """Returns each queued result in turn, recording call kwargs."""

    def __init__(self, results: list[Any]) -> None:
        self.results = list(results)
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return self.results.pop(0)


# ─── OpenAI / Copilot (identical OpenAI-compatible wire shape) ──────────────────
def _openai_seq() -> _Seq:
    tool_call = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    tool_calls=[
                        SimpleNamespace(
                            id="call_1",
                            function=SimpleNamespace(
                                name="get_weather", arguments=json.dumps({"city": "Paris"})
                            ),
                        )
                    ]
                ),
                finish_reason="tool_calls",
            )
        ],
        usage=None,
    )
    final = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content="It is 20C in Paris.", tool_calls=None),
                finish_reason="stop",
            )
        ],
        usage=SimpleNamespace(prompt_tokens=5, completion_tokens=6),
    )
    return _Seq([tool_call, final])


def test_openai_compatible_tool_loop() -> None:
    seq = _openai_seq()
    adapter = OpenAIAdapter(CFG)
    adapter._cached_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=seq))
    )

    halt = asyncio.run(adapter.invoke_tool(REQ))
    assert halt.finish_reason == "tool_use"
    assert len(halt.tool_calls) == 1
    assert halt.tool_calls[0].name == "get_weather"
    assert halt.tool_calls[0].arguments == {"city": "Paris"}
    assert len(seq.calls) == 1  # no auto-execution / auto-resume
    assert seq.calls[0]["tools"][0]["type"] == "function"

    final = asyncio.run(
        adapter.resume_tool(REQ, [ToolResult(id="call_1", name="get_weather", content="20C")])
    )
    assert final.text == "It is 20C in Paris."
    resume_msg = seq.calls[1]["messages"][-1]
    # OpenAI keys the resume by the call **id**, not the name.
    assert resume_msg == {"role": "tool", "tool_call_id": "call_1", "content": "20C"}


# ─── Copilot (agentic CLI — no host-side tool dispatch) ─────────────────────────
def test_copilot_tool_loop_answers_directly() -> None:
    prompts: list[str] = []

    async def run(prompt: str) -> Any:
        prompts.append(prompt)
        yield "It is 20C in Paris."

    adapter = CopilotAdapter(CFG)
    adapter._runner = run

    # The Copilot CLI dispatches its own tools, so there is no tool_use halt.
    halt = asyncio.run(adapter.invoke_tool(REQ))
    assert halt.finish_reason == "stop"
    assert halt.tool_calls == []
    assert halt.text == "It is 20C in Paris."

    async def run2(prompt: str) -> Any:
        prompts.append(prompt)
        yield "done"

    adapter._runner = run2
    final = asyncio.run(
        adapter.resume_tool(REQ, [ToolResult(id="call_1", name="get_weather", content="20C")])
    )
    assert final.text == "done"
    assert "get_weather: 20C" in prompts[-1]


# ─── Anthropic ─────────────────────────────────────────────────────────────────
def test_anthropic_tool_loop() -> None:
    seq = _Seq(
        [
            SimpleNamespace(
                content=[
                    SimpleNamespace(
                        type="tool_use", id="toolu_1", name="get_weather", input={"city": "Paris"}
                    )
                ],
                stop_reason="tool_use",
                usage=None,
            ),
            SimpleNamespace(
                content=[SimpleNamespace(type="text", text="It is 20C in Paris.")],
                stop_reason="end_turn",
                usage=None,
            ),
        ]
    )
    adapter = AnthropicAdapter(CFG)
    adapter._cached_client = SimpleNamespace(messages=SimpleNamespace(create=seq))

    halt = asyncio.run(adapter.invoke_tool(REQ))
    assert halt.finish_reason == "tool_use"
    assert halt.tool_calls[0].id == "toolu_1"
    assert halt.tool_calls[0].arguments == {"city": "Paris"}
    args = seq.calls[0]
    assert args["tools"][0]["input_schema"]["type"] == "object"
    assert args["tool_choice"] == {"type": "tool", "name": "get_weather"}

    final = asyncio.run(
        adapter.resume_tool(REQ, [ToolResult(id="toolu_1", name="get_weather", content="20C")])
    )
    assert final.text == "It is 20C in Paris."
    resume_msg = seq.calls[1]["messages"][-1]
    assert resume_msg["role"] == "user"
    assert resume_msg["content"][0]["type"] == "tool_result"
    # Anthropic keys the resume by the call **id**, not the name.
    assert resume_msg["content"][0]["tool_use_id"] == "toolu_1"


# ─── Gemini (automatic function calling disabled) ───────────────────────────────
def test_gemini_tool_loop_auto_calling_disabled() -> None:
    seq = _Seq(
        [
            SimpleNamespace(
                candidates=[
                    SimpleNamespace(
                        content=SimpleNamespace(
                            parts=[
                                SimpleNamespace(
                                    function_call=SimpleNamespace(
                                        name="get_weather", args={"city": "Paris"}, id=None
                                    )
                                )
                            ]
                        ),
                        finish_reason=None,
                    )
                ],
                usage_metadata=None,
                text=None,
            ),
            SimpleNamespace(
                text="It is 20C in Paris.",
                candidates=[SimpleNamespace(finish_reason="STOP", content=None)],
                usage_metadata=None,
            ),
        ]
    )
    chats_called = {"n": 0}

    async def _chats(**_kwargs: Any) -> Any:  # pragma: no cover — must never run
        chats_called["n"] += 1

    adapter = GeminiAdapter(CFG)
    adapter._cached_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=seq)),
        chats=SimpleNamespace(create=_chats),
    )

    halt = asyncio.run(adapter.invoke_tool(REQ))
    assert halt.finish_reason == "tool_use"
    assert halt.tool_calls[0].name == "get_weather"
    assert halt.tool_calls[0].arguments == {"city": "Paris"}

    config = seq.calls[0]["config"]
    assert config["tools"][0]["function_declarations"][0]["name"] == "get_weather"
    # Automatic / client-side function-calling is turned OFF (mode "NONE").
    assert config["tool_config"]["function_calling_config"]["mode"] == "NONE"
    assert config["automatic_function_calling"]["disable"] is True
    assert chats_called["n"] == 0

    # id ≠ name on purpose: Gemini must key the function response by **name**.
    final = asyncio.run(
        adapter.resume_tool(REQ, [ToolResult(id="call_1", name="get_weather", content="20C")])
    )
    assert final.text == "It is 20C in Paris."
    resume_parts = seq.calls[1]["contents"][-1]["parts"]
    assert resume_parts[0]["function_response"]["name"] == "get_weather"
