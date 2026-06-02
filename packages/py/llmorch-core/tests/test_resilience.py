"""Resilience-middleware tests — twin of core/test/resilience.test.ts. No network.

Driven with ``asyncio.run`` inside sync tests, matching the repo convention
(the project does not depend on ``pytest-asyncio``).
"""

import asyncio
from typing import Any

import pytest
from llmorch_core import ResilienceOptions, with_resilience
from llmorch_core.errors import (
    AuthenticationError,
    ProviderError,
    RateLimitError,
    TimeoutError,
)
from llmorch_core.middleware.resilience import _compute_backoff


def test_flaky_then_success_retries_n_times() -> None:
    calls = {"n": 0}

    async def flaky(_ctx: dict[str, Any]) -> str:
        calls["n"] += 1
        if calls["n"] <= 2:
            raise RateLimitError("rl", provider_id="p")
        return "ok"

    out = asyncio.run(
        with_resilience(flaky, ResilienceOptions(max_retries=3, timeout_ms=1000, base_delay_ms=1))
    )
    assert out == "ok"
    assert calls["n"] == 3


def test_non_retriable_raises_on_first_attempt() -> None:
    calls = {"n": 0}

    async def fatal(_ctx: dict[str, Any]) -> str:
        calls["n"] += 1
        raise AuthenticationError("nope", provider_id="p")

    with pytest.raises(AuthenticationError):
        asyncio.run(
            with_resilience(
                fatal, ResilienceOptions(max_retries=3, timeout_ms=1000, base_delay_ms=1)
            )
        )
    assert calls["n"] == 1


def test_timeout_maps_to_core_timeout_error() -> None:
    calls = {"n": 0}

    async def slow(_ctx: dict[str, Any]) -> str:
        calls["n"] += 1
        await asyncio.sleep(10)
        return "never"

    with pytest.raises(TimeoutError):
        asyncio.run(
            with_resilience(slow, ResilienceOptions(max_retries=2, timeout_ms=10, base_delay_ms=1))
        )
    # max_retries=2 → 3 attempts, each timed out.
    assert calls["n"] == 3


def test_provider_error_retriable_flag_gates_retry() -> None:
    retriable_calls = {"n": 0}

    async def retriable(_ctx: dict[str, Any]) -> str:
        retriable_calls["n"] += 1
        if retriable_calls["n"] < 2:
            raise ProviderError("5xx", provider_id="p", retriable=True)
        return "ok"

    out = asyncio.run(
        with_resilience(
            retriable, ResilienceOptions(max_retries=2, timeout_ms=1000, base_delay_ms=1)
        )
    )
    assert out == "ok"
    assert retriable_calls["n"] == 2

    fatal_calls = {"n": 0}

    async def fatal(_ctx: dict[str, Any]) -> str:
        fatal_calls["n"] += 1
        raise ProviderError("4xx", provider_id="p")

    with pytest.raises(ProviderError):
        asyncio.run(
            with_resilience(
                fatal, ResilienceOptions(max_retries=2, timeout_ms=1000, base_delay_ms=1)
            )
        )
    assert fatal_calls["n"] == 1


def test_jitter_produces_distinct_capped_delays() -> None:
    seq_a = iter([0.1, 0.5, 0.9])
    seq_b = iter([0.2, 0.4, 0.8])
    opts_a = ResilienceOptions(
        max_retries=3,
        timeout_ms=1000,
        base_delay_ms=100,
        max_delay_ms=1000,
        rng=lambda: next(seq_a),
    )
    opts_b = ResilienceOptions(
        max_retries=3,
        timeout_ms=1000,
        base_delay_ms=100,
        max_delay_ms=1000,
        rng=lambda: next(seq_b),
    )
    delays_a = [_compute_backoff(k, opts_a) for k in range(3)]
    delays_b = [_compute_backoff(k, opts_b) for k in range(3)]
    assert delays_a != delays_b
    for d in delays_a + delays_b:
        assert d <= opts_a.max_delay_ms / 1000.0

    # ceiling (rng→1) grows exponentially until the cap (values in seconds).
    ceil = ResilienceOptions(
        max_retries=5, timeout_ms=1000, base_delay_ms=100, max_delay_ms=1000, rng=lambda: 1.0
    )
    assert _compute_backoff(0, ceil) == pytest.approx(0.1)
    assert _compute_backoff(1, ceil) == pytest.approx(0.2)
    assert _compute_backoff(4, ceil) == pytest.approx(1.0)  # capped


def test_idempotency_key_threaded_through_every_attempt() -> None:
    seen: list[str | None] = []

    async def recording(ctx: dict[str, Any]) -> str:
        seen.append(ctx["idempotency_key"])
        if len(seen) < 2:
            raise RateLimitError("rl", provider_id="p")
        return "ok"

    out = asyncio.run(
        with_resilience(
            recording,
            ResilienceOptions(
                max_retries=1, timeout_ms=1000, base_delay_ms=1, idempotency_key="k1"
            ),
        )
    )
    assert out == "ok"
    assert seen == ["k1", "k1"]
