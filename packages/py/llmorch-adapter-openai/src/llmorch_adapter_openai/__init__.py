"""llmorch-adapter-openai: OpenAI provider adapter.

Twin of packages/ts/adapter-openai/src/index.ts. The OpenAI Chat Completions
shape is nearly 1:1 with the normalized `ChatRequest`, so this is the baseline
adapter. Self-registers under id `openai` at import time via `@register`.
"""

import json
from collections.abc import AsyncIterator
from typing import Any, TypeVar

from llmorch_core import (
    AuthenticationError,
    ChatRequest,
    FinishReason,
    LLMProvider,
    OrchestrationError,
    ProviderConfig,
    ProviderError,
    RateLimitError,
    StreamChunk,
    TokenUsage,
    ToolChoice,
    ToolInvocationRequest,
    ToolResult,
    UnifiedResponse,
    model_to_json_schema,
    parse_or_raise,
    register,
    to_openai_tools,
)
from pydantic import BaseModel

PROVIDER = "openai"

T = TypeVar("T", bound=BaseModel)


def _map_tool_choice(choice: ToolChoice) -> Any:
    """Normalized ToolChoice → OpenAI ``tool_choice``."""
    if isinstance(choice, str):
        return choice
    return {"type": "function", "function": {"name": choice.name}}


def _usage_of(res: Any) -> TokenUsage:
    usage = getattr(res, "usage", None)
    return TokenUsage(
        prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
    )


def _status_of(err: object) -> int | None:
    """Read an HTTP status off an unknown provider error."""
    status = getattr(err, "status_code", None)
    if status is None:
        status = getattr(err, "status", None)
    if status is None:
        resp = getattr(err, "response", None)
        if resp is not None:
            status = getattr(resp, "status_code", None)
    return status if isinstance(status, int) else None


def _map_finish_reason(reason: str | None) -> FinishReason:
    """OpenAI finish_reason → normalized FinishReason."""
    if reason == "length":
        return "length"
    if reason == "content_filter":
        return "content_filter"
    if reason in ("tool_calls", "function_call"):
        return "tool_use"
    return "stop"


@register(PROVIDER)
class OpenAIAdapter(LLMProvider):
    """Baseline OpenAI adapter. Self-registers under id `openai`."""

    provider_id = PROVIDER

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        self._cached_client: Any = None

    @property
    def _client(self) -> Any:
        """Lazily construct the SDK client so registration never needs a key."""
        if self._cached_client is None:
            from openai import AsyncOpenAI

            self._cached_client = AsyncOpenAI(
                api_key=self._config.api_key,
                base_url=str(self._config.base_url) if self._config.base_url else None,
            )
        return self._cached_client

    def map_request(self, req: ChatRequest) -> dict[str, Any]:
        params: dict[str, Any] = {
            "model": req.model,
            "messages": [m.model_dump(by_alias=True) for m in req.messages],
        }
        if req.temperature is not None:
            params["temperature"] = req.temperature
        if req.max_tokens is not None:
            params["max_tokens"] = req.max_tokens
        return params

    def map_response(self, res: Any) -> UnifiedResponse:
        choices = getattr(res, "choices", None) or []
        choice = choices[0] if choices else None
        message = getattr(choice, "message", None) if choice else None
        usage = getattr(res, "usage", None)
        return UnifiedResponse(
            text=getattr(message, "content", None) or "",
            usage=TokenUsage(
                prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
            ),
            tool_calls=[],
            finish_reason=_map_finish_reason(getattr(choice, "finish_reason", None)),
        )

    def map_error(self, err: object) -> OrchestrationError:
        status = _status_of(err)
        cause = err if isinstance(err, BaseException) else None
        if status == 401:
            return AuthenticationError(
                "openai: unauthorized", provider_id=self.provider_id, cause=cause
            )
        if status == 429:
            return RateLimitError("openai: rate limited", provider_id=self.provider_id, cause=cause)
        return ProviderError("openai: request failed", provider_id=self.provider_id, cause=cause)

    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        try:
            res = await self._client.chat.completions.create(**self.map_request(req))
            return self.map_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    def _tool_response(self, res: Any) -> UnifiedResponse:
        """Map a completion that may carry tool calls into a (halting) response."""
        choices = getattr(res, "choices", None) or []
        choice = choices[0] if choices else None
        message = getattr(choice, "message", None) if choice else None
        raw_calls = getattr(message, "tool_calls", None) or []
        tool_calls = [
            ToolInvocationRequest(
                id=tc.id,
                name=tc.function.name,
                arguments=json.loads(tc.function.arguments or "{}"),
            )
            for tc in raw_calls
        ]
        return UnifiedResponse(
            text=getattr(message, "content", None) or "",
            usage=_usage_of(res),
            tool_calls=tool_calls,
            finish_reason="tool_use"
            if tool_calls
            else _map_finish_reason(getattr(choice, "finish_reason", None)),
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        try:
            raw = await self._client.chat.completions.create(**self.map_request(req), stream=True)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err
        usage: TokenUsage | None = None
        finish_reason: FinishReason | None = None
        async for chunk in raw:
            choices = getattr(chunk, "choices", None) or []
            choice = choices[0] if choices else None
            delta = getattr(getattr(choice, "delta", None), "content", None)
            if delta:
                yield StreamChunk(delta=delta)
            if getattr(chunk, "usage", None):
                usage = _usage_of(chunk)
            reason = getattr(choice, "finish_reason", None)
            if reason:
                finish_reason = _map_finish_reason(reason)
        yield StreamChunk(
            delta="",
            usage=usage or TokenUsage(prompt_tokens=0, completion_tokens=0),
            finish_reason=finish_reason or "stop",
        )

    async def generate_structured(self, req: ChatRequest, schema: type[T]) -> T:
        try:
            params = self.map_request(req)
            params["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "result",
                    "strict": True,
                    "schema": model_to_json_schema(schema),
                },
            }
            res = await self._client.chat.completions.create(**params)
            content = getattr(res.choices[0].message, "content", None) or "{}"
            return parse_or_raise(schema, json.loads(content))
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse:
        try:
            params = self.map_request(req)
            if req.tools:
                params["tools"] = to_openai_tools(req.tools)
            if req.tool_choice is not None:
                params["tool_choice"] = _map_tool_choice(req.tool_choice)
            res = await self._client.chat.completions.create(**params)
            return self._tool_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse:
        """Resume after a halted tool call: append ``tool`` result messages and re-call."""
        try:
            params = self.map_request(req)
            params["messages"] = [
                *params["messages"],
                *({"role": "tool", "tool_call_id": r.id, "content": r.content} for r in results),
            ]
            res = await self._client.chat.completions.create(**params)
            return self._tool_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err


__all__ = ["PROVIDER", "OpenAIAdapter"]
