"""llmorch-adapter-anthropic: Anthropic provider adapter.

Twin of packages/ts/adapter-anthropic/src/index.ts. Normalizes the divergences
from the OpenAI baseline: system-message extraction, mandatory `max_tokens`,
text-block content, optional `cache_control`. Self-registers under id
`anthropic` at import time via `@register`.
"""

from collections.abc import AsyncIterator
from typing import Any, TypeVar

from llmorch_core import (
    AuthenticationError,
    ChatRequest,
    ContentBlock,
    FinishReason,
    LLMProvider,
    Message,
    OrchestrationError,
    ProviderConfig,
    ProviderError,
    RateLimitError,
    StreamChunk,
    TokenUsage,
    ToolInvocationRequest,
    ToolResult,
    UnifiedResponse,
    model_to_json_schema,
    parse_or_raise,
    register,
    to_anthropic_tools,
)
from pydantic import BaseModel

from .stream import anthropic_sse_to_chunks

PROVIDER = "anthropic"
DEFAULT_MAX_TOKENS = 1024

#: Stable name + description of the single tool used to force structured output.
STRUCTURED_TOOL_NAME = "result"
STRUCTURED_TOOL_DESC = "Return the result as structured JSON matching the provided schema."

T = TypeVar("T", bound=BaseModel)


def _status_of(err: object) -> int | None:
    status = getattr(err, "status_code", None)
    if status is None:
        status = getattr(err, "status", None)
    if status is None:
        resp = getattr(err, "response", None)
        if resp is not None:
            status = getattr(resp, "status_code", None)
    return status if isinstance(status, int) else None


def _text_of(content: str | list[ContentBlock]) -> str:
    """Flatten a Message's content to plain text."""
    if isinstance(content, str):
        return content
    return "".join(b.text if b.type == "text" else "" for b in content)


def _to_anthropic_message(m: Message) -> dict[str, Any]:
    """Wrap string content into a text-block array; pass blocks through."""
    content: Any = (
        [{"type": "text", "text": m.content}]
        if isinstance(m.content, str)
        else [b.model_dump(by_alias=True) for b in m.content]
    )
    return {"role": m.role, "content": content}


def _map_stop_reason(reason: str | None) -> FinishReason:
    """Anthropic stop_reason → normalized FinishReason."""
    if reason == "max_tokens":
        return "length"
    if reason == "tool_use":
        return "tool_use"
    return "stop"


@register(PROVIDER)
class AnthropicAdapter(LLMProvider):
    """Anthropic adapter. Self-registers under id `anthropic`."""

    provider_id = PROVIDER

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        self._cached_client: Any = None

    @property
    def _client(self) -> Any:
        if self._cached_client is None:
            from anthropic import AsyncAnthropic

            self._cached_client = AsyncAnthropic(
                api_key=self._config.api_key,
                base_url=str(self._config.base_url) if self._config.base_url else None,
            )
        return self._cached_client

    def map_request(self, req: ChatRequest) -> dict[str, Any]:
        system_text = "\n".join(_text_of(m.content) for m in req.messages if m.role == "system")
        convo = [m for m in req.messages if m.role != "system"]
        cache = bool(getattr(req, "cache_control", False))

        params: dict[str, Any] = {
            "model": req.model,
            "messages": [_to_anthropic_message(m) for m in convo],
            "max_tokens": req.max_tokens or DEFAULT_MAX_TOKENS,
        }
        if system_text:
            params["system"] = (
                [
                    {
                        "type": "text",
                        "text": system_text,
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
                if cache
                else system_text
            )
        if req.temperature is not None:
            params["temperature"] = req.temperature
        return params

    def map_response(self, res: Any) -> UnifiedResponse:
        blocks = getattr(res, "content", None) or []
        text_block = next((b for b in blocks if getattr(b, "type", None) == "text"), None)
        usage = getattr(res, "usage", None)
        return UnifiedResponse(
            text=getattr(text_block, "text", None) or "",
            usage=TokenUsage(
                prompt_tokens=getattr(usage, "input_tokens", 0) or 0,
                completion_tokens=getattr(usage, "output_tokens", 0) or 0,
            ),
            tool_calls=[],
            finish_reason=_map_stop_reason(getattr(res, "stop_reason", None)),
        )

    def map_error(self, err: object) -> OrchestrationError:
        status = _status_of(err)
        cause = err if isinstance(err, BaseException) else None
        if status == 401:
            return AuthenticationError(
                "anthropic: unauthorized", provider_id=self.provider_id, cause=cause
            )
        if status == 429:
            return RateLimitError(
                "anthropic: rate limited", provider_id=self.provider_id, cause=cause
            )
        return ProviderError("anthropic: request failed", provider_id=self.provider_id, cause=cause)

    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        try:
            res = await self._client.messages.create(**self.map_request(req))
            return self.map_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    def _tool_response(self, res: Any) -> UnifiedResponse:
        """Map a response that may carry ``tool_use`` blocks into a (halting) response."""
        blocks = getattr(res, "content", None) or []
        text_block = next((b for b in blocks if getattr(b, "type", None) == "text"), None)
        tool_calls = [
            ToolInvocationRequest(
                id=getattr(b, "id", "") or "",
                name=getattr(b, "name", "") or "",
                arguments=getattr(b, "input", None) or {},
            )
            for b in blocks
            if getattr(b, "type", None) == "tool_use"
        ]
        return UnifiedResponse(
            text=getattr(text_block, "text", None) or "",
            usage=TokenUsage(
                prompt_tokens=getattr(getattr(res, "usage", None), "input_tokens", 0) or 0,
                completion_tokens=getattr(getattr(res, "usage", None), "output_tokens", 0) or 0,
            ),
            tool_calls=tool_calls,
            finish_reason="tool_use"
            if tool_calls
            else _map_stop_reason(getattr(res, "stop_reason", None)),
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        try:
            raw = await self._client.messages.create(**self.map_request(req), stream=True)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err
        async for chunk in anthropic_sse_to_chunks(raw):
            yield chunk

    async def generate_structured(self, req: ChatRequest, schema: type[T]) -> T:
        try:
            tool = {
                "name": STRUCTURED_TOOL_NAME,
                "description": STRUCTURED_TOOL_DESC,
                "input_schema": model_to_json_schema(schema),
            }
            params = self.map_request(req)
            params["tools"] = [tool]
            params["tool_choice"] = {"type": "tool", "name": STRUCTURED_TOOL_NAME}
            res = await self._client.messages.create(**params)
            blocks = getattr(res, "content", None) or []
            block = next((b for b in blocks if getattr(b, "type", None) == "tool_use"), None)
            # Validate against the ORIGINAL model — constraints Anthropic strips
            # (min_length/max_length/pattern) are still enforced here.
            return parse_or_raise(schema, getattr(block, "input", None) or {})
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse:
        try:
            params = self.map_request(req)
            if req.tools:
                params["tools"] = to_anthropic_tools(req.tools)
            if req.tool_choice is not None and not isinstance(req.tool_choice, str):
                params["tool_choice"] = {"type": "tool", "name": req.tool_choice.name}
            res = await self._client.messages.create(**params)
            return self._tool_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse:
        """Resume after a halted tool call: append a ``tool_result`` block then re-call."""
        try:
            params = self.map_request(req)
            params["messages"] = [
                *params["messages"],
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": r.id, "content": r.content}
                        for r in results
                    ],
                },
            ]
            res = await self._client.messages.create(**params)
            return self._tool_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err


__all__ = ["PROVIDER", "AnthropicAdapter"]
