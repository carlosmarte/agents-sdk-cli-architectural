"""Copilot streaming test — twin of adapter-copilot/test/stream.test.ts.

The CLI streams its reply as stdout chunks; the adapter yields each as a delta
then a terminal chunk. There is no token usage, so the terminal usage is zero.
"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from llmorch_adapter_copilot import CopilotAdapter
from llmorch_core import ProviderConfig
from llmorch_core.models import ChatRequest, Message

CFG = ProviderConfig(provider="copilot", api_key="k")
REQ = ChatRequest(model="m", messages=[Message(role="user", content="hi")])


def test_yields_cli_chunks_then_terminal() -> None:
    deltas = ["Hel", "lo", "!"]

    async def run(_prompt: str) -> AsyncIterator[str]:
        for d in deltas:
            yield d

    adapter = CopilotAdapter(CFG)
    adapter._runner = run

    async def collect() -> list[Any]:
        return [c async for c in adapter.stream(REQ)]

    chunks = asyncio.run(collect())
    assert "".join(c.delta for c in chunks if c.delta != "") == "Hello!"
    terminal = chunks[-1]
    assert terminal.delta == ""
    assert terminal.usage is not None
    assert terminal.usage.prompt_tokens == 0
    assert terminal.usage.completion_tokens == 0
    assert terminal.finish_reason == "stop"
