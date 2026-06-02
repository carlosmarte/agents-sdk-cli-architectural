import pytest
from llmorch_core.interface import LLMProvider


def test_incomplete_subclass_raises_type_error() -> None:
    class Incomplete(LLMProvider):
        pass

    with pytest.raises(TypeError):
        Incomplete()  # type: ignore[abstract]
