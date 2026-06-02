"""llmorch-core: Universal Interface, domain models, factory, orchestrator."""

from .config import ProviderConfig, ProviderId, resolve_config
from .context import current_trace_id, new_trace_id, run_with_trace
from .errors import (
    AuthenticationError,
    OrchestrationError,
    ProviderError,
    RateLimitError,
    SchemaValidationError,
    TimeoutError,
    ToolExecutionError,
    UnknownProviderError,
    UnsupportedFeatureError,
)
from .factory import create_provider, register, registered_providers
from .interface import LLMProvider, LLMProviderProtocol, StreamChunk
from .middleware.resilience import ResilienceOptions, with_resilience
from .models import (
    ChatRequest,
    ContentBlock,
    FinishReason,
    Message,
    NamedToolChoice,
    ReasoningEffort,
    Role,
    TextBlock,
    TokenUsage,
    ToolChoice,
    ToolDefinition,
    ToolInvocationRequest,
    ToolResult,
    ToolResultBlock,
    UnifiedResponse,
)
from .orchestrator import Orchestrator, create_orchestrator
from .schema import model_to_json_schema, parse_or_raise
from .telemetry import (
    NoopTelemetryHook,
    StructuredLogTelemetryHook,
    TelemetryContext,
    TelemetryHook,
)
from .tools import to_anthropic_tools, to_gemini_tools, to_openai_tools

CORE_PACKAGE = "llmorch-core"

__all__ = [
    "CORE_PACKAGE",
    "AuthenticationError",
    "ChatRequest",
    "ContentBlock",
    "FinishReason",
    "LLMProvider",
    "LLMProviderProtocol",
    "Message",
    "NamedToolChoice",
    "NoopTelemetryHook",
    "Orchestrator",
    "OrchestrationError",
    "ProviderConfig",
    "ProviderError",
    "ProviderId",
    "RateLimitError",
    "ReasoningEffort",
    "ResilienceOptions",
    "Role",
    "SchemaValidationError",
    "StreamChunk",
    "StructuredLogTelemetryHook",
    "TelemetryContext",
    "TelemetryHook",
    "TextBlock",
    "TimeoutError",
    "TokenUsage",
    "ToolChoice",
    "ToolDefinition",
    "ToolExecutionError",
    "ToolInvocationRequest",
    "ToolResult",
    "ToolResultBlock",
    "UnifiedResponse",
    "UnknownProviderError",
    "UnsupportedFeatureError",
    "create_orchestrator",
    "create_provider",
    "current_trace_id",
    "model_to_json_schema",
    "new_trace_id",
    "parse_or_raise",
    "register",
    "registered_providers",
    "resolve_config",
    "run_with_trace",
    "to_anthropic_tools",
    "to_gemini_tools",
    "to_openai_tools",
    "with_resilience",
]
