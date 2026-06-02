from llmorch_sdk import create_orchestrator


def test_reexports_create_orchestrator() -> None:
    assert callable(create_orchestrator)


def test_builds_an_orchestrator_for_each_provider() -> None:
    for provider in ("openai", "anthropic", "gemini", "copilot", "local"):
        orch = create_orchestrator({"provider": provider, "api_key": "k"})
        assert hasattr(orch, "chat")
