"""Cross-adapter stateless-chat parity — twin of core/test/chat-cross-adapter.test.ts."""

import asyncio
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import llmorch_core.factory as factory_mod
import pytest
from fixtures.fake_provider import FakeProvider
from llmorch_adapter_anthropic import AnthropicAdapter
from llmorch_adapter_copilot import CopilotAdapter
from llmorch_adapter_gemini import GeminiAdapter
from llmorch_adapter_openai import OpenAIAdapter
from llmorch_core import ProviderConfig, UnifiedResponse, create_orchestrator, register
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="openai", api_key="k")

HISTORY = ChatRequest(
    model="m",
    messages=[
        Message(role="system", content="be terse"),
        Message(role="user", content="hi"),
        Message(role="assistant", content="hello"),
        Message(role="user", content="again"),
    ],
)

OPENAI_RES = SimpleNamespace(
    choices=[SimpleNamespace(message=SimpleNamespace(content="ok"), finish_reason="stop")],
    usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4),
)
ANTHROPIC_RES = SimpleNamespace(
    content=[SimpleNamespace(type="text", text="ok")],
    usage=SimpleNamespace(input_tokens=3, output_tokens=4),
    stop_reason="end_turn",
)
GEMINI_RES = SimpleNamespace(
    text="ok",
    usage_metadata=SimpleNamespace(prompt_token_count=3, candidates_token_count=4),
    candidates=[SimpleNamespace(finish_reason="STOP", content=None)],
)


class _Recorder:
    """Records call kwargs and returns a canned result."""

    def __init__(self, result: Any) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return self.result


def _openai(adapter: Any, rec: _Recorder) -> Any:
    adapter._cached_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=rec))
    )
    return adapter


class _CopilotRunner:
    """Records the flattened prompt and yields a canned reply (CLI runner stand-in)."""

    def __init__(self, content: str = "ok") -> None:
        self.content = content
        self.prompts: list[str] = []

    async def __call__(self, prompt: str) -> Any:
        self.prompts.append(prompt)
        yield self.content


def _copilot(adapter: Any, runner: _CopilotRunner) -> Any:
    adapter._runner = runner
    return adapter


def _anthropic(adapter: Any, rec: _Recorder) -> Any:
    adapter._cached_client = SimpleNamespace(messages=SimpleNamespace(create=rec))
    return adapter


def _gemini(adapter: Any, rec: _Recorder, chats: Any) -> Any:
    adapter._cached_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=rec)),
        chats=SimpleNamespace(create=chats),
    )
    return adapter


def test_full_history_serialized_every_turn() -> None:
    oa = _Recorder(OPENAI_RES)
    cp = _CopilotRunner()
    an, ge = _Recorder(ANTHROPIC_RES), _Recorder(GEMINI_RES)
    asyncio.run(_openai(OpenAIAdapter(CFG), oa).chat(HISTORY))
    asyncio.run(_copilot(CopilotAdapter(CFG), cp).chat(HISTORY))
    asyncio.run(_anthropic(AnthropicAdapter(CFG), an).chat(HISTORY))
    asyncio.run(_gemini(GeminiAdapter(CFG), ge, SimpleNamespace()).chat(HISTORY))

    # OpenAI keeps the system turn inline → all 4 messages.
    assert len(oa.calls[0]["messages"]) == 4
    # Copilot flattens the full history into one CLI prompt (nothing dropped).
    assert all(turn in cp.prompts[0] for turn in ("be terse", "hi", "hello", "again"))
    # Anthropic hoists system out → 3 messages + a `system` param.
    assert len(an.calls[0]["messages"]) == 3
    assert an.calls[0]["system"] == "be terse"
    # Gemini hoists system into config → 3 contents.
    assert len(ge.calls[0]["contents"]) == 3
    assert ge.calls[0]["config"]["system_instruction"] == "be terse"


def test_no_hidden_state_between_calls() -> None:
    oa = _Recorder(OPENAI_RES)
    adapter = _openai(OpenAIAdapter(CFG), oa)
    asyncio.run(
        adapter.chat(ChatRequest(model="m", messages=[Message(role="user", content="first")]))
    )
    asyncio.run(
        adapter.chat(ChatRequest(model="m", messages=[Message(role="user", content="second")]))
    )
    assert len(oa.calls[1]["messages"]) == 1
    assert oa.calls[1]["messages"][0]["content"] == "second"


def test_gemini_uses_generate_content_never_chats() -> None:
    ge = _Recorder(GEMINI_RES)
    chats_calls = {"n": 0}

    async def _chats(**_kwargs: Any) -> Any:  # pragma: no cover — must never run
        chats_calls["n"] += 1

    asyncio.run(_gemini(GeminiAdapter(CFG), ge, _chats).chat(HISTORY))
    assert len(ge.calls) == 1
    assert chats_calls["n"] == 0


def test_identical_normalized_shape_across_adapters() -> None:
    oa = asyncio.run(_openai(OpenAIAdapter(CFG), _Recorder(OPENAI_RES)).chat(HISTORY))
    cp = asyncio.run(_copilot(CopilotAdapter(CFG), _CopilotRunner()).chat(HISTORY))
    an = asyncio.run(_anthropic(AnthropicAdapter(CFG), _Recorder(ANTHROPIC_RES)).chat(HISTORY))
    ge = asyncio.run(
        _gemini(GeminiAdapter(CFG), _Recorder(GEMINI_RES), SimpleNamespace()).chat(HISTORY)
    )

    for res in (oa, cp, an, ge):
        assert isinstance(res, UnifiedResponse)
        assert res.text == "ok"
        assert res.tool_calls == []
        assert res.finish_reason == "stop"
        # Same normalized field set in every language.
        assert set(res.model_dump().keys()) == {"text", "usage", "tool_calls", "finish_reason"}
    # The REST adapters surface provider token usage; the Copilot CLI reports
    # none, so its usage is normalized to zero.
    for res in (oa, an, ge):
        assert res.usage.prompt_tokens == 3
        assert res.usage.completion_tokens == 4
    assert cp.usage.prompt_tokens == 0
    assert cp.usage.completion_tokens == 0


@pytest.fixture()
def _isolate_registry() -> Iterator[None]:
    saved = dict(factory_mod._REGISTRY)
    yield
    factory_mod._REGISTRY.clear()
    factory_mod._REGISTRY.update(saved)


class _Telemetry:
    def __init__(self) -> None:
        self.starts: list[tuple[str, str]] = []
        self.ends: list[tuple[str, str]] = []
        self.errors: list[tuple[str, str]] = []

    def on_request_start(self, ctx: Any) -> None:
        self.starts.append((ctx.method, ctx.provider_id))

    def on_request_end(self, ctx: Any, usage: Any) -> None:
        self.ends.append((ctx.method, ctx.provider_id))

    def on_error(self, ctx: Any, err: BaseException) -> None:
        self.errors.append((ctx.method, ctx.provider_id))

    def on_token(self, ctx: Any, token: str) -> None:
        pass


def test_orchestrator_chat_passthrough(_isolate_registry: None) -> None:
    register("openai")(FakeProvider)
    tel = _Telemetry()
    orch = create_orchestrator({"provider": "openai", "api_key": "k"}, telemetry=tel)
    res = asyncio.run(orch.chat(HISTORY))
    assert res.text == "chat:openai"  # passthrough — unchanged
    assert tel.starts == [("chat", "openai")]
    assert len(tel.ends) == 1
