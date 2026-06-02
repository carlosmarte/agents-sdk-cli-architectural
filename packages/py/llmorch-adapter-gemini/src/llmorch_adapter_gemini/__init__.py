"""llmorch-adapter-gemini: Google Gemini provider adapter.

Twin of packages/ts/adapter-gemini/src/index.ts. Generation params nest inside a
`GenerateContentConfig`, and the call is the stateless `models.generate_content`
(never `chats.create`). Self-registers under id `gemini` at import time.
"""

import copy
import json
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
    ReasoningEffort,
    StreamChunk,
    TokenUsage,
    ToolInvocationRequest,
    ToolResult,
    UnifiedResponse,
    model_to_json_schema,
    parse_or_raise,
    register,
    to_gemini_tools,
)
from pydantic import BaseModel

PROVIDER = "gemini"

T = TypeVar("T", bound=BaseModel)


def _process_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline ``$ref``/``$defs`` so Gemini's ``response_schema`` is self-contained.

    Pydantic emits a ``$ref`` pointer into a ``$defs`` table for every nested model;
    Gemini's structured-output API rejects ``$ref``. This walks the schema, replaces
    each ``#/$defs/<name>`` (or ``#/definitions/<name>``) pointer with a copy of the
    referenced definition (recursively inlined), and drops the ``$defs`` table.

    It is deliberately dependency-free — mirroring the TS side's dependency-free
    ``zodToJsonSchema`` choice — rather than routing through
    ``google.genai._transformers.process_schema``: that private symbol's signature
    drifts across versions (in google-genai 2.6.0 it requires a ``client`` arg and
    mutates in place, returning ``None``), so calling it portably is brittle.

    Recursive/self-referential models (a ``$ref`` whose target is already being
    expanded) cannot be fully inlined; the offending ``$ref`` is dropped rather than
    emitted, degrading gracefully instead of sending Gemini something it rejects.
    """
    root = copy.deepcopy(schema)
    defs: dict[str, Any] = {}
    for key in ("$defs", "definitions"):
        table = root.pop(key, None)
        if isinstance(table, dict):
            defs.update(table)

    def resolve(node: Any, seen: frozenset[str]) -> Any:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                name = ref.rsplit("/", 1)[-1]
                if name in defs and name not in seen:
                    target = resolve(defs[name], seen | {name})
                    merged = dict(target) if isinstance(target, dict) else {}
                    for key, value in node.items():
                        if key != "$ref":
                            merged[key] = resolve(value, seen)
                    return merged
                # Unresolvable or recursive — strip the $ref, keep any siblings.
                return {k: resolve(v, seen) for k, v in node.items() if k != "$ref"}
            return {k: resolve(v, seen) for k, v in node.items()}
        if isinstance(node, list):
            return [resolve(v, seen) for v in node]
        return node

    return resolve(root, frozenset())  # type: ignore[no-any-return]


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
    if isinstance(content, str):
        return content
    return "".join(b.text if b.type == "text" else "" for b in content)


def thinking_config_for(effort: ReasoningEffort | None) -> dict[str, int] | None:
    """reasoning_effort → Gemini thinking_config (omitted when None)."""
    if effort == "low":
        return {"thinking_budget": 1024}
    if effort == "medium":
        return {"thinking_budget": 8192}
    if effort == "high":
        return {"thinking_budget": 24576}
    return None


def _map_finish_reason(reason: str | None) -> FinishReason:
    """Gemini finish_reason → normalized FinishReason."""
    if reason == "MAX_TOKENS":
        return "length"
    if reason in ("SAFETY", "RECITATION"):
        return "content_filter"
    return "stop"


def _to_gemini_content(m: Message) -> dict[str, Any]:
    """Map a normalized message to a Gemini Content (assistant → "model")."""
    return {
        "role": "model" if m.role == "assistant" else "user",
        "parts": [{"text": _text_of(m.content)}],
    }


@register(PROVIDER)
class GeminiAdapter(LLMProvider):
    """Gemini adapter. Self-registers under id `gemini`."""

    provider_id = PROVIDER

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        self._cached_client: Any = None

    @property
    def _client(self) -> Any:
        if self._cached_client is None:
            from google import genai

            self._cached_client = genai.Client(api_key=self._config.api_key)
        return self._cached_client

    def map_request(self, req: ChatRequest) -> dict[str, Any]:
        system_instruction = "\n".join(
            _text_of(m.content) for m in req.messages if m.role == "system"
        )
        contents = [_to_gemini_content(m) for m in req.messages if m.role != "system"]

        config: dict[str, Any] = {}
        if system_instruction:
            config["system_instruction"] = system_instruction
        if req.temperature is not None:
            config["temperature"] = req.temperature
        if req.max_tokens is not None:
            config["max_output_tokens"] = req.max_tokens
        thinking = thinking_config_for(req.reasoning_effort)
        if thinking is not None:
            config["thinking_config"] = thinking

        return {"model": req.model, "contents": contents, "config": config}

    def map_response(self, res: Any) -> UnifiedResponse:
        usage = getattr(res, "usage_metadata", None)
        candidates = getattr(res, "candidates", None) or []
        candidate = candidates[0] if candidates else None
        return UnifiedResponse(
            text=getattr(res, "text", None) or "",
            usage=TokenUsage(
                prompt_tokens=getattr(usage, "prompt_token_count", 0) or 0,
                completion_tokens=getattr(usage, "candidates_token_count", 0) or 0,
            ),
            tool_calls=[],
            finish_reason=_map_finish_reason(
                getattr(candidate, "finish_reason", None) if candidate else None
            ),
        )

    def map_error(self, err: object) -> OrchestrationError:
        status = _status_of(err)
        message = str(getattr(err, "message", "") or err)
        cause = err if isinstance(err, BaseException) else None
        if status == 401 or "PERMISSION_DENIED" in message:
            return AuthenticationError(
                "gemini: unauthorized", provider_id=self.provider_id, cause=cause
            )
        if status == 429 or "RESOURCE_EXHAUSTED" in message:
            return RateLimitError("gemini: rate limited", provider_id=self.provider_id, cause=cause)
        return ProviderError("gemini: request failed", provider_id=self.provider_id, cause=cause)

    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        try:
            res = await self._client.aio.models.generate_content(**self.map_request(req))
            return self.map_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    def _tool_response(self, res: Any) -> UnifiedResponse:
        """Map a response that may carry ``function_call`` parts into a (halting) response."""
        candidates = getattr(res, "candidates", None) or []
        candidate = candidates[0] if candidates else None
        content = getattr(candidate, "content", None) if candidate else None
        parts = getattr(content, "parts", None) or []
        tool_calls = []
        for i, part in enumerate(parts):
            fc = getattr(part, "function_call", None)
            if fc is not None:
                tool_calls.append(
                    ToolInvocationRequest(
                        id=getattr(fc, "id", None) or f"call_{i}",
                        name=getattr(fc, "name", "") or "",
                        arguments=getattr(fc, "args", None) or {},
                    )
                )
        usage = getattr(res, "usage_metadata", None)
        return UnifiedResponse(
            text=getattr(res, "text", None) or "",
            usage=TokenUsage(
                prompt_tokens=getattr(usage, "prompt_token_count", 0) or 0,
                completion_tokens=getattr(usage, "candidates_token_count", 0) or 0,
            ),
            tool_calls=tool_calls,
            finish_reason="tool_use"
            if tool_calls
            else _map_finish_reason(
                getattr(candidate, "finish_reason", None) if candidate else None
            ),
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        try:
            raw = await self._client.aio.models.generate_content_stream(**self.map_request(req))
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err
        usage: TokenUsage | None = None
        finish_reason: FinishReason | None = None
        async for chunk in raw:
            text = getattr(chunk, "text", None)
            if text:
                yield StreamChunk(delta=text)
            if getattr(chunk, "usage_metadata", None):
                meta = chunk.usage_metadata
                usage = TokenUsage(
                    prompt_tokens=getattr(meta, "prompt_token_count", 0) or 0,
                    completion_tokens=getattr(meta, "candidates_token_count", 0) or 0,
                )
            candidates = getattr(chunk, "candidates", None) or []
            reason = getattr(candidates[0], "finish_reason", None) if candidates else None
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
            # Inline $ref in nested objects before handing the schema to Gemini.
            processed = _process_schema(model_to_json_schema(schema))
            params["config"]["response_mime_type"] = "application/json"
            params["config"]["response_schema"] = processed
            res = await self._client.aio.models.generate_content(**params)
            return parse_or_raise(schema, json.loads(getattr(res, "text", None) or "{}"))
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse:
        try:
            params = self.map_request(req)
            if req.tools:
                params["config"]["tools"] = to_gemini_tools(req.tools)
            # Turn off the SDK's client-side function-calling helper so the model's
            # call surfaces to the host (manual halt loop) instead of being run.
            params["config"]["tool_config"] = {"function_calling_config": {"mode": "NONE"}}
            params["config"]["automatic_function_calling"] = {"disable": True}
            res = await self._client.aio.models.generate_content(**params)
            return self._tool_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse:
        """Resume after a halted tool call: append a ``function_response`` Part then re-call.

        Gemini keys the function response by the function **name** (``ToolResult.name``),
        unlike OpenAI/Anthropic/Copilot which key by the call **id**.
        """
        try:
            params = self.map_request(req)
            params["contents"] = [
                *params["contents"],
                {
                    "role": "user",
                    "parts": [
                        {"function_response": {"name": r.name, "response": {"result": r.content}}}
                        for r in results
                    ],
                },
            ]
            res = await self._client.aio.models.generate_content(**params)
            return self._tool_response(res)
        except OrchestrationError:
            raise
        except Exception as err:
            raise self.map_error(err) from err


__all__ = ["PROVIDER", "GeminiAdapter", "thinking_config_for"]
