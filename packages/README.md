# packages — polyglot workspace root

Two runnable workspace roots live here — `ts/` (pnpm, all `@llmorch/*` packages)
and `py/` (uv, all `llmorch_*` packages) — plus the language-neutral
`fixtures/parity/` golden fixtures shared by both twins. This root `Makefile`
fans every target out to both languages.

## Targets

| Target      | What it runs                                                                 |
| ----------- | ---------------------------------------------------------------------------- |
| `ci`        | `make -C ts ci` then `make -C py ci` — per-language lint + test + build.      |
| `lint`      | Lint both languages.                                                         |
| `test`      | Test both languages (**parity excluded** — it is a separate gate).           |
| `build`     | Build both languages.                                                        |
| `parity`    | The cross-language twin-drift gate (see below).                              |
| `ci-parity` | `ci` then `parity` — the full gate CI runs.                                  |

## `make ci` vs `make parity`

- **`make ci`** runs the normal per-language pipeline (lint → test → build) for
  TS and Python. It is intentionally fast and does **not** run the parity
  harness, so the default `test` step in each language excludes the parity cases.

- **`make parity`** loads the shared `fixtures/parity/` golden fixtures and
  asserts the TS and Python twins normalize each recorded provider payload to a
  **byte-equivalent** `UnifiedResponse` JSON. It delegates to both sub-Makefiles
  with `&&`, so it **fails fast on the first drifting language**: a TS-side drift
  short-circuits before the Python run, and the single non-zero exit names the
  language that drifted.

- **`make ci-parity`** runs the full per-language CI pipelines and then the
  parity gate — exiting `0` only when everything passes. This is the combined
  gate the CI workflow (`.github/workflows/ci.yml`) enforces: a `parity` job runs
  after the `ts` and `py` jobs and blocks the merge on any twin divergence.

To see the gate bite, mutate one twin's normalizer (or one
`fixtures/parity/*/expected.json`) and run `make parity` — the drifting language
fails with a JSON diff while the other stays green.
