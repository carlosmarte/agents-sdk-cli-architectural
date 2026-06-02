"""Resilience middleware — twin of packages/ts/core/src/middleware/resilience.ts.

`with_resilience` wraps the coroutine the orchestrator uses to invoke the
resolved provider, making it resilient *once* in core rather than in every
adapter: exponential backoff + full jitter on retriable errors only, an
``asyncio.wait_for`` per-attempt deadline that surfaces a core ``TimeoutError``,
and an idempotency key threaded unchanged across attempts. It imports only the
error taxonomy and the stdlib ``asyncio``/``random`` — no adapter or SDK.
"""

import asyncio
import random as _random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from ..errors import ProviderError, RateLimitError, TimeoutError

T = TypeVar("T")

# The context dict handed to the wrapped call on every attempt.
CallContext = dict[str, Any]


@dataclass
class ResilienceOptions:
    """Tuning for :func:`with_resilience`.

    ``max_retries`` + ``timeout_ms`` are sourced by the orchestrator from
    ``ProviderConfig``; the rest have defaults. ``rng`` is injectable so tests
    can make jitter deterministic.
    """

    max_retries: int
    timeout_ms: int
    base_delay_ms: int = 100
    max_delay_ms: int = 10_000
    idempotency_key: str | None = None
    rng: Callable[[], float] = field(default=_random.random)


def _is_retriable(err: BaseException) -> bool:
    """Retriable iff a rate limit, a timeout, or a ``ProviderError`` so flagged."""
    if isinstance(err, (RateLimitError, TimeoutError)):
        return True
    return isinstance(err, ProviderError) and bool(getattr(err, "retriable", False))


def _compute_backoff(attempt: int, opts: ResilienceOptions) -> float:
    """Full-jitter exponential backoff in *seconds* (0-based ``attempt``)."""
    # `int ** int` is typed `Any` in typeshed (negative exponents yield float),
    # so pin the arithmetic to float explicitly.
    ceiling: float = min(opts.base_delay_ms * 2**attempt, opts.max_delay_ms)
    return ceiling * opts.rng() / 1000.0


async def with_resilience(
    call: Callable[[CallContext], Awaitable[T]],
    opts: ResilienceOptions,
) -> T:
    """Drive ``call`` to success through backoff retries, or raise the final error.

    Each attempt is bounded by ``timeout_ms`` via ``asyncio.wait_for``; an expiry
    maps the ``asyncio.TimeoutError`` to a core ``TimeoutError`` (then itself
    subject to retry). Retriable errors are retried with jittered exponential
    backoff capped by ``max_retries``; everything else propagates immediately.
    """
    last_err: BaseException | None = None
    for attempt in range(opts.max_retries + 1):
        ctx: CallContext = {"idempotency_key": opts.idempotency_key}
        try:
            return await asyncio.wait_for(call(ctx), timeout=opts.timeout_ms / 1000.0)
        # `asyncio.TimeoutError` is the builtin TimeoutError, which our import of
        # the core TimeoutError shadows — keep the qualified name so this catches
        # the deadline (not our own core error) and remaps it. (ruff UP041 N/A.)
        except asyncio.TimeoutError as e:  # noqa: UP041
            err: BaseException = TimeoutError(f"request exceeded {opts.timeout_ms}ms")
            err.__cause__ = e
        except BaseException as e:  # noqa: BLE001 — re-raised below; we only branch on retriability
            err = e
        last_err = err
        if attempt < opts.max_retries and _is_retriable(err):
            await asyncio.sleep(_compute_backoff(attempt, opts))
            continue
        raise err
    # Unreachable: the loop always returns or raises.
    assert last_err is not None
    raise last_err
