---
name: llmorch-env-setup
description: Set up a working environment for the llmorch polyglot multi-provider LLM orchestration SDK+CLI (TypeScript + Python). Bootstrap the pnpm and uv workspaces, build/install the packages, wire the four provider API-key environment variables (OpenAI / Anthropic / Gemini / GitHub Copilot), and verify the install offline with the key-free `fake` provider and `llmorch providers`. Use when standing up llmorch in a new repo, CI runner, container, or dev machine; when a provider call fails with a missing-key or unknown-provider error; or before running any integration that imports `@llmorch/sdk` / `llmorch_sdk`.
---

# llmorch — Environment Setup

Bring the `llmorch` SDK+CLI to a runnable state in one or both languages and prove it works **without a live API key**. The architecture is registry-backed and provider-agnostic (see `orchestration-sdk-cli-architect`), so "setup" is two things: build the workspace, then resolve provider config from the environment.

## 1. Workspace bootstrap

The repo is a polyglot monorepo: a pnpm workspace under `packages/ts/` and a uv workspace under `packages/py/`. A top-level `packages/Makefile` wraps both.

```bash
# Both languages, from packages/
make -C packages ci          # lint + test + build, both langs
make -C packages ci-parity   # the above, then the TS↔Py parity gate

# TypeScript only
cd packages/ts && pnpm install && pnpm -r build

# Python only (uv-managed, Python 3.11+)
cd packages/py && uv sync && uv run pytest
```

Package topology (each is a workspace member):

| Role | TS | Python |
| --- | --- | --- |
| Shared core (port, models, factory, orchestrator, resilience, telemetry) | `@llmorch/core` | `llmorch-core` |
| Batteries-included facade (registers all adapters) | `@llmorch/sdk` | `llmorch-sdk` |
| CLI front-end | `@llmorch/cli` (bin `llmorch`) | `llmorch-cli` (`llmorch` console script) |
| Provider adapters | `@llmorch/adapter-{openai,anthropic,gemini,copilot}` | `llmorch-adapter-{openai,anthropic,gemini,copilot}` |

> **Resolution gotcha (TS):** from the `packages/ts` root `@llmorch/sdk` may not resolve by package name in every tool context — import the built entry by path when a by-name import fails. The `sdk` facade only works after `pnpm -r build` has produced the adapter dist outputs (the adapters self-register at import time).

## 2. Provider API keys

Config precedence is **explicit argument > provider-specific env var > generic env var > default** (`resolveConfig` / `resolve_config`). Set the per-provider key env var:

| Provider id | API-key env var | Default model |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-latest` |
| `gemini` | `GEMINI_API_KEY` | `gemini-1.5-flash` |
| `copilot` | `GITHUB_TOKEN` | `gpt-4o` (GitHub Models REST endpoint) |

Generic fallbacks: `LLMORCH_PROVIDER` (default provider id), `LLMORCH_API_KEY` (key used when the provider-specific one is unset). Never commit keys — export them in the shell, a `.env` the runtime loads, or CI secrets.

## 3. Verify offline — the `fake` provider

`FakeProvider` lives **in core** (`packages/ts/core/src/testing/`, `packages/py/.../testing/`), needs no key and no network, and implements all five modalities. The CLI exposes it via `--provider fake`; it is never registered globally, so `providers` still lists exactly the four real providers.

```bash
# CLI smoke test — no key required
llmorch providers                                    # lists the 4 real providers + key_present flags
LLMORCH_FAKE_TEXT="pong" llmorch chat "ping" --provider fake   # -> pong
echo '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}' > /tmp/s.json
LLMORCH_FAKE_STRUCTURED='{"ok":true}' llmorch structured "x" --provider fake --schema /tmp/s.json
```

Offline env hooks: `LLMORCH_FAKE_TEXT` seeds chat/stream output; `LLMORCH_FAKE_STRUCTURED` (JSON) seeds the `structured` payload (must validate against the supplied schema).

## 4. Verdict checklist

- [ ] `pnpm -r build` / `uv sync` succeed; `make -C packages ci` is green.
- [ ] `llmorch providers` runs and shows `key_present=true` for the providers you intend to use.
- [ ] `llmorch chat "ping" --provider fake` returns text (proves the orchestrator wiring end-to-end, no key).
- [ ] A real one-shot (`llmorch chat "hi" --provider openai`) succeeds once a key is set.

If `chat` raises `UnknownProviderError`, the adapters never self-registered — confirm you imported `@llmorch/sdk`/`llmorch_sdk` (not just `core`) and that the build produced adapter outputs. If it raises `AuthenticationError`, the key env var is missing or wrong for that provider id.

## See also

- `llmorch-sdk-integration` — embed the orchestrator in an app.
- `llmorch-cli-integration` — script the CLI.
- `llmorch-add-provider-adapter` — add a fifth provider.
- `orchestration-devtool-test-harness` — the FakeProvider / injection testing pattern.
