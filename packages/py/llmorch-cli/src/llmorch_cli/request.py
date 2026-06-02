"""Build a ChatRequest from resolved flags + prompt — twin of request.ts.

``ChatRequest.model`` is required by the contract, so when no ``--model`` is given
we fall back to the provider's default model (or a placeholder for the ``fake``
provider, which ignores it). ``llmorch_core`` is imported lazily inside the
function to keep module import cheap and the ``--help`` path fast.
"""

from typing import TYPE_CHECKING, Any

from .flags import ResolvedFlags
from .providers_info import default_model_for

if TYPE_CHECKING:
    from llmorch_core import ChatRequest


def build_chat_request(flags: ResolvedFlags, prompt: str) -> "ChatRequest":
    from llmorch_core import ChatRequest

    model = flags.model or default_model_for(flags.provider) or "default"
    data: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    if flags.temperature is not None:
        data["temperature"] = flags.temperature
    if flags.max_tokens is not None:
        data["maxTokens"] = flags.max_tokens
    return ChatRequest.model_validate(data)
