import llmorch_sdk


def test_importing_sdk_registers_exactly_the_providers() -> None:
    assert sorted(llmorch_sdk.registered_providers()) == [
        "anthropic",
        "copilot",
        "gemini",
        "local",
        "openai",
    ]


def test_reexports_orchestrator_constructor() -> None:
    assert callable(llmorch_sdk.create_orchestrator)
