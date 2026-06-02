"""Story 02 — command registration + deferred-import discipline (Python twin)."""

import subprocess
import sys

from llmorch_cli import app
from typer.testing import CliRunner

runner = CliRunner()


def test_help_lists_all_four_commands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for name in ("chat", "stream", "structured", "providers"):
        assert name in result.stdout


def test_sdk_not_imported_at_module_load() -> None:
    """Importing __main__ must not pull in llmorch_sdk (heavy import is deferred).

    Run in a fresh interpreter so a prior in-process import of llmorch_sdk by
    another test cannot leak into sys.modules and mask a regression.
    """
    code = "import sys, llmorch_cli.__main__; assert 'llmorch_sdk' not in sys.modules"
    result = subprocess.run([sys.executable, "-c", code])
    assert result.returncode == 0
