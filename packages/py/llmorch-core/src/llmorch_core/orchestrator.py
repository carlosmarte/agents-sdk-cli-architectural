"""Orchestrator facade — twin of packages/ts/core/src/orchestrator.ts.

`create_orchestrator` resolves config (Story 02), creates the provider(s) via the
factory (Story 01), and returns a facade delegating the unified-interface methods
with an ordered fallback chain. Each provider call is wrapped in
:func:`with_resilience` (backoff + jitter on retriable errors, per-attempt
timeout, idempotency passthrough) and runs inside a trace context so a
``trace_id`` flows to nested coroutines and the injected ``TelemetryHook``
without manual threading (Feature 07, Stories 01 + 02).
"""

from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from typing import Any, TypeVar

from pydantic import BaseModel

from .config import ProviderConfig, resolve_config
from .context import current_trace_id, new_trace_id, run_with_trace
from .errors import OrchestrationError
from .factory import create_provider
from .interface import LLMProvider, StreamChunk
from .middleware.resilience import ResilienceOptions, with_resilience
from .models import ChatRequest, TokenUsage, ToolResult, UnifiedResponse
from .telemetry import NoopTelemetryHook, TelemetryContext, TelemetryHook

T = TypeVar("T")
M = TypeVar("M", bound=BaseModel)

_ZERO_USAGE = TokenUsage(prompt_tokens=0, completion_tokens=0)


def _usage_of(out: object) -> TokenUsage:
    """Read a normalized ``TokenUsage`` off a result if it carries one, else zero."""
    usage = getattr(out, "usage", None)
    return usage if isinstance(usage, TokenUsage) else _ZERO_USAGE


class Orchestrator:
    """Delegates the unified interface to a provider chain with failover."""

    def __init__(
        self,
        chain: list[tuple[LLMProvider, ProviderConfig]],
        telemetry: TelemetryHook | None = None,
    ) -> None:
        self._chain = chain
        self._t: TelemetryHook = telemetry if telemetry is not None else NoopTelemetryHook()

    async def _run(
        self,
        method: str,
        call: Callable[[LLMProvider], Awaitable[T]],
        usage: Callable[[T], TokenUsage],
    ) -> T:
        trace_id = current_trace_id() or new_trace_id()
        with run_with_trace(trace_id):
            last_err: BaseException | None = None
            for provider, config in self._chain:
                ctx = TelemetryContext(trace_id, provider.provider_id, method)
                self._t.on_request_start(ctx)

                # with_resilience drives this thunk (awaited before the loop
                # advances, so capturing `provider` directly is safe).
                async def _invoke(_ctx: dict[str, Any], p: LLMProvider = provider) -> T:
                    return await call(p)

                try:
                    out = await with_resilience(
                        _invoke,
                        ResilienceOptions(
                            max_retries=config.max_retries,
                            timeout_ms=config.timeout_ms,
                        ),
                    )
                    self._t.on_request_end(ctx, usage(out))
                    return out
                except OrchestrationError as err:
                    self._t.on_error(ctx, err)
                    last_err = err
                    if err.retriable:
                        continue
                    raise
            assert last_err is not None
            raise last_err

    async def chat(self, req: ChatRequest) -> UnifiedResponse:
        return await self._run("chat", lambda p: p.chat(req), _usage_of)

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        trace_id = current_trace_id() or new_trace_id()
        with run_with_trace(trace_id):
            last_err: BaseException | None = None
            for provider, _config in self._chain:
                ctx = TelemetryContext(trace_id, provider.provider_id, "stream")
                self._t.on_request_start(ctx)
                try:
                    usage = _ZERO_USAGE
                    async for chunk in provider.stream(req):
                        if chunk.delta:
                            self._t.on_token(ctx, chunk.delta)
                        if chunk.usage is not None:
                            usage = chunk.usage
                        yield chunk
                    self._t.on_request_end(ctx, usage)
                    return
                except OrchestrationError as err:
                    self._t.on_error(ctx, err)
                    last_err = err
                    if err.retriable:
                        continue
                    raise
            assert last_err is not None
            raise last_err

    async def generate_structured(self, req: ChatRequest, schema: type[M]) -> M:
        return await self._run(
            "generate_structured",
            lambda p: p.generate_structured(req, schema),
            lambda _out: _ZERO_USAGE,
        )

    async def invoke_tool(self, req: ChatRequest) -> UnifiedResponse:
        return await self._run("invoke_tool", lambda p: p.invoke_tool(req), _usage_of)

    async def resume_tool(self, req: ChatRequest, results: list[ToolResult]) -> UnifiedResponse:
        return await self._run("resume_tool", lambda p: p.resume_tool(req, results), _usage_of)


def create_orchestrator(
    config: ProviderConfig | Mapping[str, Any] | Sequence[ProviderConfig | Mapping[str, Any]],
    *,
    telemetry: TelemetryHook | None = None,
) -> Orchestrator:
    """Build an orchestrator from one config or an ordered fallback chain."""
    raw: list[ProviderConfig | Mapping[str, Any]]
    if isinstance(config, (ProviderConfig, Mapping)):
        raw = [config]
    else:
        raw = list(config)
    chain: list[tuple[LLMProvider, ProviderConfig]] = []
    for c in raw:
        partial = c.model_dump() if isinstance(c, ProviderConfig) else dict(c)
        resolved = resolve_config(**partial)
        chain.append((create_provider(resolved), resolved))
    return Orchestrator(chain, telemetry)
