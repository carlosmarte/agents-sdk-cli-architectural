"""llmorch-sdk: batteries-included facade — registers adapters, exposes create_orchestrator.

Importing this package triggers the side-effect import of all four provider
adapters, each of which self-registers via `@register(...)` at module load. The
orchestrator constructor is then re-exported from `llmorch_core`, so a consumer
gets a working multi-provider orchestrator from a single import.
"""

# Import side effects register each adapter via @register(...).
import llmorch_adapter_anthropic  # noqa: F401
import llmorch_adapter_copilot  # noqa: F401
import llmorch_adapter_gemini  # noqa: F401
import llmorch_adapter_openai  # noqa: F401
from llmorch_core import create_orchestrator, registered_providers

__all__ = ["create_orchestrator", "registered_providers"]
