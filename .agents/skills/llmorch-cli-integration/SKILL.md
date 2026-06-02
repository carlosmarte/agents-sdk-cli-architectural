---
name: llmorch-cli-integration
description: Drive or embed the llmorch command-line tool (`llmorch`) — the four commands (chat, stream, structured, providers), the global flags (--provider/--model/--temperature/--max-tokens), the --schema JSON-Schema file for structured output, and the key-free `fake` provider for offline/CI use. Covers scripting llmorch from shells, Makefiles, and CI, plus embedding the TS `run(argv)` entry or the Python Typer `app`. Use when the user asks to "use the CLI", "run llmorch from a script", "add llmorch to CI", "pipe a prompt through the CLI", or to call the orchestrator without writing SDK code.
---

# llmorch — CLI Integration

The `llmorch` CLI is a thin driving adapter over the same `Orchestrator` core the SDK uses (see `orchestration-devtool-hexagonal-core`) — so anything the CLI does, the SDK does identically. Reach for the CLI when you want a model call from a shell, a Makefile, or a CI step without writing code.

## Commands

| Command | Effect |
| --- | --- |
| `llmorch chat "<prompt>"` | one-shot prompt → text answer on stdout |
| `llmorch stream "<prompt>"` | streams each text delta to stdout as it arrives |
| `llmorch structured "<prompt>" --schema ./s.json` | schema-validated JSON to stdout |
| `llmorch providers` | lists the four real providers + resolved default model + `key_present` flag (makes **no** model call, loads **no** SDK) |

## Global flags + precedence

`--provider <id>` (env `LLMORCH_PROVIDER`), `--model <name>` (defaults per provider), `--temperature <n>`, `--max-tokens <n>`. Precedence is explicit flag > env var > per-provider default. `--help`/`-h` is served from static metadata — it imports no command handler and no provider SDK, so it is instant.

```bash
llmorch chat "Explain idempotency keys" --provider anthropic --model claude-3-5-sonnet-latest
llmorch stream "Write a haiku about retries" --provider openai --temperature 0.7
llmorch structured "Extract name and age: Ada, 36" --provider openai --schema ./person.schema.json
```

`person.schema.json` is plain JSON Schema (object/string/number/integer/boolean/array/enum + `required`); the CLI bridges it to a Zod/Pydantic schema and validates the model's output against it, exiting non-zero with a message if it fails.

## Offline / CI — the `fake` provider

`--provider fake` runs the in-core `FakeProvider`: no key, no network, deterministic. Ideal for CI smoke tests and demos. Seed output with env vars:

```bash
LLMORCH_FAKE_TEXT="ok" llmorch chat "anything" --provider fake          # -> ok
LLMORCH_FAKE_STRUCTURED='{"name":"Ada","age":36}' \
  llmorch structured "x" --provider fake --schema ./person.schema.json  # must validate
```

`fake` is never registered globally, so `llmorch providers` still lists exactly the four real providers.

## Exit codes

`0` success · `1` user error (unknown command, missing `--schema`, unreadable schema file, structured output failed validation). Unknown command prints the command list to stderr and returns `1`.

## Scripting it

```bash
# CI gate: prove the binary + wiring work with no secrets
set -euo pipefail
llmorch providers >/dev/null
out=$(LLMORCH_FAKE_TEXT=pong llmorch chat ping --provider fake)
[ "$out" = "pong" ] || { echo "smoke failed"; exit 1; }
```

```makefile
smoke:
	LLMORCH_FAKE_TEXT=pong llmorch chat ping --provider fake | grep -qx pong
```

## Embedding the CLI in another program

**TypeScript** — call the `run` entry directly (it returns the exit code and accepts injectable deps for tests/embedding):
```ts
import { run } from "@llmorch/cli";
const code = await run(["chat", "hello", "--provider", "fake"], {
  stdout: (s) => buffer.push(s),
  orchestrator: fakeOrchestrator,  // inject to skip the SDK build entirely
  env: { ...process.env },
});
```
The bin entry is `packages/ts/cli/bin/llmorch.mjs`.

**Python** — the Typer application is exposed as `llmorch_cli.__main__:app` (console script `llmorch`); mount it under your own Typer app or invoke via `typer.testing.CliRunner` in tests.

## How it stays fast (don't break it)

Commands are lazily `import()`ed by name; the heavy `@llmorch/sdk` (which loads every provider SDK) is imported only inside `buildOrchestrator`, only when a handler actually needs a model. `providers` and `--help` never trigger it. If you add a command, keep handlers thin (parse·validate·render) and reach the orchestrator only through `ctx.getOrchestrator()` — see `orchestration-cli-routing-architect`.

## Pointers

- CLI entry/routing: `packages/ts/cli/src/{run,loader,manifest,context}.ts`; `packages/py/llmorch-cli/src/llmorch_cli/__main__.py`
- Commands: `packages/ts/cli/src/commands/`
- Runnable examples: `.plans/02/examples/cli/`
