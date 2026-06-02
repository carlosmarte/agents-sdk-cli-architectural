"""llmorch-cli: Typer application — twin of the TypeScript @llmorch/cli.

The CLI is a thin driving adapter over the same ``Orchestrator`` core the SDK
exposes. Top-level imports are limited to ``typer`` + stdlib; every heavy import
(``llmorch_sdk``, ``llmorch_core``, provider SDKs) is deferred *inside* command
bodies / ``build_context``, so ``llmorch --help`` parses the command tree without
loading the SDK.
"""

import asyncio
import json
from pathlib import Path

import typer

app = typer.Typer(
    help="llmorch — multi-provider LLM orchestration CLI.",
    no_args_is_help=True,
    add_completion=False,
)


@app.callback()
def main(
    ctx: typer.Context,
    provider: str | None = typer.Option(None, "--provider", envvar="LLMORCH_PROVIDER"),
    model: str | None = typer.Option(None, "--model"),
    temperature: float | None = typer.Option(None, "--temperature"),
    max_tokens: int | None = typer.Option(None, "--max-tokens"),
) -> None:
    """Resolve the global flags onto the context for the subcommands."""
    ctx.obj = {
        "provider": provider,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


@app.command()
def chat(ctx: typer.Context, prompt: str) -> None:
    """One-shot prompt → text answer."""
    from .context import build_context
    from .flags import resolve_flags
    from .request import build_chat_request

    cli = build_context(**ctx.obj)
    req = build_chat_request(resolve_flags(ctx.obj), prompt)
    res = asyncio.run(cli.orchestrator.chat(req))
    typer.echo(res.text)


@app.command()
def stream(ctx: typer.Context, prompt: str) -> None:
    """Prompt → streamed text on stdout."""
    from .context import build_context
    from .flags import resolve_flags
    from .request import build_chat_request

    cli = build_context(**ctx.obj)
    req = build_chat_request(resolve_flags(ctx.obj), prompt)

    async def _drain() -> None:
        async for chunk in cli.orchestrator.stream(req):
            typer.echo(chunk.delta, nl=False)

    asyncio.run(_drain())


@app.command()
def structured(
    ctx: typer.Context,
    prompt: str,
    schema: Path = typer.Option(..., "--schema", help="Path to a JSON Schema file"),
) -> None:
    """Prompt + --schema JSON → validated JSON."""
    from .context import build_context
    from .flags import resolve_flags
    from .request import build_chat_request
    from .schema_bridge import json_schema_to_model

    if not schema.is_file():
        typer.echo(f"structured: schema file not found: {schema}", err=True)
        raise typer.Exit(code=1)
    try:
        schema_obj = json.loads(schema.read_text())
    except (OSError, json.JSONDecodeError):
        typer.echo(f"structured: cannot read or parse schema file: {schema}", err=True)
        raise typer.Exit(code=1) from None

    model_cls = json_schema_to_model(schema_obj)
    cli = build_context(**ctx.obj)
    req = build_chat_request(resolve_flags(ctx.obj), prompt)
    try:
        res = asyncio.run(cli.orchestrator.generate_structured(req, model_cls))
    except Exception as err:  # noqa: BLE001 — surface a clean, non-zero exit
        typer.echo(f"structured: output did not satisfy the schema: {err}", err=True)
        raise typer.Exit(code=1) from err
    typer.echo(json.dumps(res.model_dump(), indent=2))


@app.command()
def providers(ctx: typer.Context) -> None:
    """List registered providers + resolved config (no model call)."""
    import os

    from .providers_info import PROVIDER_INFO

    for info in PROVIDER_INFO:
        present = "true" if os.environ.get(info.key_env) else "false"
        typer.echo(f"{info.id}  default_model={info.default_model}  key_present={present}")


if __name__ == "__main__":
    app()
