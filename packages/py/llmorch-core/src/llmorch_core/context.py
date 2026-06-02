"""Trace-id context propagation — twin of packages/ts/core/src/context.ts.

A request/trace id is carried through the call graph via a module-level
``contextvars.ContextVar`` — explicitly *not* a global Hub. ``asyncio`` copies
the context per task, so concurrent orchestrator calls carry independent trace
ids, and any nested coroutine reads the current id via :func:`current_trace_id`
without it being threaded through a parameter.
"""

import contextvars
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

_trace_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "llmorch_trace_id", default=None
)


def new_trace_id() -> str:
    """Mint a fresh trace id."""
    return str(uuid.uuid4())


def current_trace_id() -> str | None:
    """The trace id of the enclosing :func:`run_with_trace`, else ``None``."""
    return _trace_id.get()


@contextmanager
def run_with_trace(trace_id: str) -> Iterator[None]:
    """Establish ``trace_id`` as the current trace for the duration of the block.

    Works across ``await`` boundaries: the ``ContextVar`` set here is visible to
    any coroutine awaited inside the block (same task) and to the telemetry hook.
    """
    token = _trace_id.set(trace_id)
    try:
        yield
    finally:
        _trace_id.reset(token)
