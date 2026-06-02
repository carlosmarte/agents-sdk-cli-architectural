"""Polyglot parity harness (Python twin) — twin of packages/ts/core/parity/parity.test.ts.

Loads the SAME language-neutral golden fixtures under ``packages/fixtures/parity/``
that the TS runner loads, feeds each recorded provider-native payload through the
matching adapter's ``map_response`` normalizer, and asserts the canonicalized
``UnifiedResponse`` equals the expected fixture. Because inputs and expected
outputs are shared, any normalizer drift fails in exactly the language that
drifted. Selected via ``pytest -m parity``; no network.
"""

import json
import pathlib
import re
from types import SimpleNamespace
from typing import Any

import pytest
from llmorch_adapter_anthropic import AnthropicAdapter
from llmorch_adapter_copilot import CopilotAdapter
from llmorch_adapter_gemini import GeminiAdapter
from llmorch_adapter_local import LocalAdapter
from llmorch_adapter_openai import OpenAIAdapter
from llmorch_core import LLMProvider, ProviderConfig

# packages/py/llmorch-core/tests/ → parents[3] == packages/  → packages/fixtures/parity
ROOT = pathlib.Path(__file__).resolve().parents[3] / "fixtures" / "parity"
MANIFEST: list[dict[str, Any]] = json.loads((ROOT / "manifest.json").read_text())

# A key-less config is safe: adapters construct their SDK client lazily and
# `map_response` is a pure normalizer that never touches the client.
_CFG = ProviderConfig(provider="openai", api_key="test")
_ADAPTERS: dict[str, LLMProvider] = {
    "openai": OpenAIAdapter(_CFG),
    "anthropic": AnthropicAdapter(_CFG),
    "gemini": GeminiAdapter(_CFG),
    "copilot": CopilotAdapter(_CFG),
    "local": LocalAdapter(_CFG),
}

_CAMEL = re.compile(r"(?<!^)(?=[A-Z])")


def _snake(key: str) -> str:
    return _CAMEL.sub("_", key).lower()


def _to_ns(value: Any) -> Any:
    """Recursively turn a JSON object into attribute-accessible objects, mirroring
    the provider SDK response shape the adapters expect. Dict keys are converted to
    snake_case so the snake_case-reading Python adapters (notably Gemini, whose
    fixture carries the JS SDK's camelCase keys) resolve the same single fixture."""
    if isinstance(value, dict):
        return SimpleNamespace(**{_snake(k): _to_ns(v) for k, v in value.items()})
    if isinstance(value, list):
        return [_to_ns(v) for v in value]
    return value


def _canonicalize(obj: Any) -> str:
    """Sorted-key, compact JSON — the cross-language canonical form."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


@pytest.mark.parity
@pytest.mark.parametrize("case", MANIFEST, ids=lambda c: c["id"])
def test_parity(case: dict[str, Any]) -> None:
    recorded = json.loads((ROOT / case["recorded"]).read_text())
    adapter = _ADAPTERS[case["provider"]]

    normalized = adapter.map_response(_to_ns(recorded["providerResponse"]))  # type: ignore[attr-defined]
    # by_alias → camelCase (matches the TS wire form); exclude_none drops absent
    # optionals (e.g. reasoning_tokens) so equal values serialize byte-identically.
    got = _canonicalize(normalized.model_dump(by_alias=True, exclude_none=True))
    want = _canonicalize(json.loads((ROOT / case["expected"]).read_text()))
    assert got == want
