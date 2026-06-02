# Polyglot parity fixtures

Language-neutral golden fixtures shared by **both** twins — the TS runner
(`packages/ts/core/parity/parity.test.ts`) and the Python runner
(`packages/py/llmorch-core/tests/test_parity.py`) load these **same** files. No
per-language copies exist; any normalizer drift between the mjs and py adapters
surfaces as a failing assertion in exactly the language that drifted.

## Layout

```
parity/
  manifest.json          # index of cases
  <id>/recorded.json     # provider-native request + response payload
  <id>/expected.json     # canonical normalized UnifiedResponse
```

`manifest.json` is an array of `{ id, provider, recorded, expected, note }`. The
runner reads each case's `recorded.providerResponse`, feeds it through the named
`provider`'s adapter response normalizer (`mapResponse` / `map_response`), and
asserts the canonicalized result equals `expected.json`.

## Provider-native payload conventions

`recorded.providerResponse` mirrors the **actual SDK response shape** per
provider, so the real adapter normalizers consume it unchanged:

- **openai / anthropic** — snake_case wire keys (`prompt_tokens`,
  `finish_reason`, `stop_reason`, `input_tokens`, …). Both twins read these
  directly.
- **copilot** — the Copilot CLI SDK reply shape (`{data:{content}}`). It carries
  no token accounting, so the normalizer reports zero usage in both twins.
- **gemini** — camelCase keys (`usageMetadata`, `promptTokenCount`,
  `candidatesTokenCount`, `candidates[].finishReason`), matching the JS Gemini
  SDK. The Python Gemini adapter expects snake_case attributes, so the Python
  runner's dict→object adapter exposes snake_case aliases (camelCase keys are
  converted) — the single fixture still drives both twins.

## Canonicalization contract

Both runners serialize the normalized `UnifiedResponse` with the **same** rule so
equal values are byte-identical across languages:

- **sorted keys**, recursively;
- **compact separators** (`,` and `:`, no whitespace);
- **integer token counts** (no floats);
- optional/absent fields are **omitted** (e.g. `usage.reasoningTokens` /
  `reasoning_tokens` when `None`) rather than serialized as `null`.

The `UnifiedResponse` shape compared is:

```json
{
  "finishReason": "stop|length|tool_use|content_filter",
  "text": "…",
  "toolCalls": [],
  "usage": { "completionTokens": 0, "promptTokens": 0 }
}
```

To prove the harness bites, mutate one `expected.json` token count (or one twin's
normalizer) and run `make parity` in both languages: the drifting language fails
with a JSON diff while the other stays green.
