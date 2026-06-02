"""The Hexagonal seam for the Python CLI — twin of context.ts.

``build_context`` is the single place the CLI constructs an ``Orchestrator`` from
resolved config. The heavy ``llmorch_sdk`` import is deferred *inside* the function
so importing this module (or ``__main__``) stays cheap and ``llmorch --help`` never
loads the SDK. ``set_orchestrator_override`` is the test seam used by ``CliRunner``
to inject a ``FakeProvider``-backed orchestrator. The special ``fake`` provider
builds the in-``core`` ``FakeProvider`` for offline, key-free verification — it is
never registered globally, so ``providers`` still lists the four real providers.
"""

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

_override: Any = None


def set_orchestrator_override(orch: Any) -> None:
    """Test seam: force ``build_context`` to return this orchestrator (or clear with None)."""
    global _override
    _override = orch


def _get_override() -> Any:
    return _override


@dataclass
class CliContext:
    orchestrator: Any
    flags: dict[str, Any] = field(default_factory=dict)


def _build_fake(env: Mapping[str, str]) -> Any:
    from llmorch_core.testing import FakeProvider

    kwargs: dict[str, Any] = {}
    text = env.get("LLMORCH_FAKE_TEXT")
    if text is not None:
        kwargs["text"] = text
    raw = env.get("LLMORCH_FAKE_STRUCTURED")
    if raw is not None:
        kwargs["structured"] = json.loads(raw)
    return FakeProvider(**kwargs)


def build_context(**flags: Any) -> CliContext:
    """Resolve config and construct the orchestrator (or return the test override)."""
    if _override is not None:
        return CliContext(orchestrator=_override, flags=flags)

    from .flags import resolve_flags

    resolved = resolve_flags(flags)
    if resolved.provider == "fake":
        return CliContext(orchestrator=_build_fake(os.environ), flags=flags)

    from llmorch_sdk import create_orchestrator  # deferred import (fast --help)

    config: dict[str, Any] = {"provider": resolved.provider}
    if resolved.model:
        config["default_model"] = resolved.model
    return CliContext(orchestrator=create_orchestrator(config), flags=flags)
