"""Telemetry hooks — twin of packages/ts/core/src/telemetry.ts.

A ``TelemetryHook`` Protocol with four callbacks the orchestrator drives:
``on_request_start`` before the (resilient) provider call, ``on_request_end``
with the response's normalized ``TokenUsage`` on success, ``on_error`` on
failure, and ``on_token`` per chunk while streaming. Ships a no-op default
(opt-in telemetry) and a structured-logging implementation.
"""

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any, Protocol, runtime_checkable

from .models import TokenUsage


@dataclass
class TelemetryContext:
    """Identifying context passed to every telemetry callback."""

    trace_id: str
    provider_id: str
    method: str


@runtime_checkable
class TelemetryHook(Protocol):
    """The observability seam the orchestrator drives (lifecycle per call:
    ``on_request_start`` → (``on_token``…)? → ``on_request_end`` on success, or
    ``on_request_start`` → ``on_error`` on failure)."""

    def on_request_start(self, ctx: TelemetryContext) -> None: ...
    def on_request_end(self, ctx: TelemetryContext, usage: TokenUsage) -> None: ...
    def on_error(self, ctx: TelemetryContext, err: BaseException) -> None: ...
    def on_token(self, ctx: TelemetryContext, token: str) -> None: ...


class NoopTelemetryHook:
    """Default hook: telemetry is opt-in, so every callback is a safe no-op."""

    def on_request_start(self, ctx: TelemetryContext) -> None:
        pass

    def on_request_end(self, ctx: TelemetryContext, usage: TokenUsage) -> None:
        pass

    def on_error(self, ctx: TelemetryContext, err: BaseException) -> None:
        pass

    def on_token(self, ctx: TelemetryContext, token: str) -> None:
        pass


class StructuredLogTelemetryHook:
    """Emits one structured record per event, carrying the trace/provider/method
    and the normalized ``TokenUsage`` on ``request.end``. The sink defaults to
    ``print(json.dumps(...))`` but is injectable; each method swallows sink
    errors so telemetry never breaks the request path."""

    def __init__(self, log: Callable[[dict[str, Any]], None] | None = None) -> None:
        self._log = log if log is not None else (lambda r: print(json.dumps(r)))

    def _emit(self, rec: dict[str, Any]) -> None:
        try:
            self._log(rec)
        except Exception:  # noqa: BLE001 — telemetry must never surface its own failure
            pass

    def on_request_start(self, ctx: TelemetryContext) -> None:
        self._emit({"event": "request.start", **asdict(ctx)})

    def on_request_end(self, ctx: TelemetryContext, usage: TokenUsage) -> None:
        self._emit(
            {"event": "request.end", **asdict(ctx), "usage": usage.model_dump(by_alias=True)}
        )

    def on_error(self, ctx: TelemetryContext, err: BaseException) -> None:
        self._emit({"event": "error", **asdict(ctx), "error": str(err)})

    def on_token(self, ctx: TelemetryContext, token: str) -> None:
        self._emit({"event": "token", **asdict(ctx), "token": token})
