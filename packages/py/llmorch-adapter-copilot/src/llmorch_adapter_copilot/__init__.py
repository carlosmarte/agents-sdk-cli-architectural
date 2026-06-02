"""llmorch-adapter-copilot: GitHub Copilot provider adapter (Copilot CLI).

Twin of ``packages/ts/adapter-copilot/src/index.ts``. ``@github/copilot-sdk`` is
Node-only, so the Python adapter follows the same setup via the documented
non-Node path: it shells out to the ``@github/copilot`` CLI with
``--disable-builtin-mcps``, resolving the binary the way the reference
``resolveCopilotCli()`` does (PATH lookup, then ``COPILOT_CLI_PATH``).
Self-registers under id ``copilot`` at import time.

Capability notes (mirroring the TS twin, whose SDK surface is intentionally
small):

* The CLI surfaces no token accounting, so ``usage`` is always reported zero.
* There is no strict JSON-schema mode; :meth:`CopilotAdapter.generate_structured`
  embeds the schema in the prompt and parses/validates the reply.
* The CLI dispatches its own tools internally and never surfaces host-side
  function tool calls, so :meth:`CopilotAdapter.invoke_tool` answers directly
  (no ``tool_use`` halt) and :meth:`CopilotAdapter.resume_tool` folds prior tool
  results into the prompt.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from collections.abc import AsyncIterator, Callable
from typing import Any, TypeVar

from llmorch_core import (
    AuthenticationError,
    ChatRequest,
    LLMProvider,
    OrchestrationError,
    ProviderConfig,
    ProviderError,
    RateLimitError,
    StreamChunk,
    TokenUsage,
    ToolResult,
    UnifiedResponse,
    model_to_json_schema,
    parse_or_raise,
    register,
)
from pydantic import BaseModel

PROVIDER = "copilot"

#: CLI args passed to every Copilot invocation — mirrors the reference
#: ``cliArgs: ["--disable-builtin-mcps"]`` so the session stays on the bare
#: surface (no built-in MCP tool servers).
COPILOT_CLI_ARGS: list[str] = ["--disable-builtin-mcps"]

T = TypeVar("T", bound=BaseModel)

#: A runner yields the assistant reply as text chunks for a single prompt.
CliRunner = Callable[[str], AsyncIterator[str]]

_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)
_NO_USAGE = TokenUsage(prompt_tokens=0, completion_tokens=0)


def resolve_copilot_cli() -> str:
    """Resolve the ``@github/copilot`` CLI binary the adapter shells out to.

    Looks on ``PATH`` first, then falls back to ``COPILOT_CLI_PATH`` — the Python
    equivalent of the reference ``resolveCopilotCli()``.
    """
    found = shutil.which("copilot")
    if found:
        return found
    env = os.environ.get("COPILOT_CLI_PATH")
    if env:
        return env
    raise RuntimeError("Copilot CLI not found. Install @github/copilot or set COPILOT_CLI_PATH.")


async def _default_runner(prompt: str) -> AsyncIterator[str]:
    """Spawn ``copilot -p <prompt> --allow-all-tools --disable-builtin-mcps`` and
    stream its stdout. ``--allow-all-tools`` is the CLI counterpart of the SDK's
    ``approveAll`` permission handler."""
    cli = resolve_copilot_cli()
    proc = await asyncio.create_subprocess_exec(
        cli,
        "-p",
        prompt,
        "--allow-all-tools",
        *COPILOT_CLI_ARGS,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdout is not None
    async for line in proc.stdout:
        yield line.decode("utf-8", errors="replace")
    code = await proc.wait()
    if code != 0:
        detail = ""
        if proc.stderr is not None:
            detail = (await proc.stderr.read()).decode("utf-8", errors="replace")
        raise RuntimeError(f"copilot CLI exited with status {code}: {detail}")


def _flatten_prompt(req: ChatRequest) -> str:
    """Flatten a stateless message history into one prompt for the CLI session."""
    parts: list[str] = []
    for m in req.messages:
        content = m.content if isinstance(m.content, str) else str(m.content)
        if m.role == "system":
            parts.append(f"[system]\n{content}")
        elif m.role == "assistant":
            parts.append(f"[assistant]\n{content}")
        elif m.role == "tool":
            parts.append(f"[tool result]\n{content}")
        else:
            parts.append(content)
    return "\n\n".join(parts)


def _extract_json(text: str) -> str:
    """Best-effort extraction of a JSON object/array from free-form model text."""
    fenced = _FENCE.search(text)
    body = fenced.group(1) if fenced else text
    start = next((i for i, ch in enumerate(body) if ch in "{["), -1)
    if start == -1:
        return body.strip()
    end = max(body.rfind("}"), body.rfind("]"))
    return body[start : end + 1] if end > start else body[start:]


@register(PROVIDER)
class CopilotAdapter(LLMProvider):
    """GitHub Copilot adapter over the Copilot CLI. Self-registers under id ``copilot``."""

    provider_id = PROVIDER

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        # Injectable seam: tests set a fake runner; production uses the CLI.
        self._runner: CliRunner | None = None

    async def _collect(self, prompt: str) -> str:
        runner = self._runner or _default_runner
        return "".join([chunk async for chunk in runner(prompt)])

    def _response(self, text: str) -> UnifiedResponse:
        return UnifiedResponse(
            text=text, usage=_NO_USAGE, tool_calls=[], finish_reason="stop"
        )

    def map_response(self, res: Any) -> UnifiedResponse:
        """Normalize a Copilot reply (``{data: {content}}``) into a UnifiedResponse."""
        data = getattr(res, "data", None)
        content = getattr(data, "content", None) if data is not None else None
        return self._response(content or "")

    def map_error(self, err: object) -> OrchestrationError:
        if isinstance(err, OrchestrationError):
            return err
        cause = err if isinstance(err, BaseException) else None
        msg = str(getattr(err, "message", None) or err or "")
        if re.search(r"unauthor|forbidden|\b401\b|\b403\b|auth|token|login|gh auth", msg, re.I):
            return AuthenticationError(
                "copilot: unauthorized", provider_id=self.provider_id, cause=cause
            )
        if re.search(r"rate.?limit|\b429\b|quota|too many requests", msg, re.I):
            return RateLimitError(
                "copilot: rate limited", provider_id=self.provider_id, cause=cause
            )
        return ProviderError("copilot: request failed", provider_id=self.provider_id, cause=cause)

    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        try:
            return self._response(await self._collect(_flatten_prompt(req)))
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        runner = self._runner or _default_runner
        try:
            async for chunk in runner(_flatten_prompt(req)):
                if chunk:
                    yield StreamChunk(delta=chunk)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err
        yield StreamChunk(delta="", usage=_NO_USAGE, finish_reason="stop")

    async def generate_structured(self, req: ChatRequest, schema: type[T]) -> T:
        try:
            prompt = "\n".join(
                [
                    _flatten_prompt(req),
                    "",
                    "Respond with ONLY a single JSON value conforming to this JSON Schema.",
                    "Do not wrap it in markdown fences, comments, or any surrounding prose.",
                    json.dumps(model_to_json_schema(schema)),
                ]
            )
            text = await self._collect(prompt)
            return parse_or_raise(schema, json.loads(_extract_json(text) or "{}"))
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse:
        # The Copilot CLI dispatches its own tools and never surfaces host-side
        # function tool calls, so there is no tool_use halt — answer directly.
        return await self.chat(req)

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse:
        """Fold any prior tool results into the prompt as context, then answer."""
        try:
            prompt = "\n".join(
                [
                    _flatten_prompt(req),
                    "",
                    "[tool results]",
                    *[f"- {r.name or r.id}: {r.content}" for r in results],
                ]
            )
            return self._response(await self._collect(prompt))
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err


__all__ = ["PROVIDER", "COPILOT_CLI_ARGS", "CopilotAdapter", "resolve_copilot_cli"]
