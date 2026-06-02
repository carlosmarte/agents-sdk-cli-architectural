"""Global-flag resolution — twin of packages/ts/cli/src/flags.ts.

Precedence: explicit flag > env var > (left to the request/config layer) default.
Only ``--provider`` has an env layer of its own (``LLMORCH_PROVIDER``).
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass
class ResolvedFlags:
    provider: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def resolve_flags(opts: Mapping[str, Any], env: Mapping[str, str] | None = None) -> ResolvedFlags:
    """Resolve the four global options with precedence flag > env."""
    env = env if env is not None else os.environ
    temperature = opts.get("temperature")
    max_tokens = opts.get("max_tokens")
    return ResolvedFlags(
        provider=_as_str(opts.get("provider")) or env.get("LLMORCH_PROVIDER"),
        model=_as_str(opts.get("model")),
        temperature=float(temperature) if isinstance(temperature, (int, float)) else None,
        max_tokens=int(max_tokens) if isinstance(max_tokens, int) else None,
    )
