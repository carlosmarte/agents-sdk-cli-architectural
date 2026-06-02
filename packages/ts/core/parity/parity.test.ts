import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ProviderConfig } from "../src/config.js";

import { AnthropicAdapter } from "../../adapter-anthropic/src/index.js";
import { CopilotAdapter } from "../../adapter-copilot/src/index.js";
import { GeminiAdapter } from "../../adapter-gemini/src/index.js";
import { LocalAdapter } from "../../adapter-local/src/index.js";
import { OpenAIAdapter } from "../../adapter-openai/src/index.js";

/**
 * Shared, language-neutral golden fixtures live in `packages/fixtures/parity/`
 * and are loaded by BOTH this runner and the Python twin
 * (`packages/py/llmorch-core/tests/test_parity.py`). Each case feeds a recorded
 * provider-native payload through the matching adapter's `mapResponse` and
 * asserts the canonicalized `UnifiedResponse` equals the expected fixture — so
 * any mjs↔py normalizer drift fails in exactly the language that drifted.
 */
const ROOT = fileURLToPath(new URL("../../../fixtures/parity/", import.meta.url));

interface ManifestCase {
  id: string;
  provider: string;
  recorded: string;
  expected: string;
  note: string;
}

const manifest: ManifestCase[] = JSON.parse(
  readFileSync(`${ROOT}manifest.json`, "utf8"),
);

// Adapters construct their SDK client lazily, so a key-less config is safe;
// `mapResponse` is a pure normalizer that never touches the client.
const cfg = { provider: "openai", apiKey: "test" } as unknown as ProviderConfig;
const normalizers: Record<string, (res: unknown) => unknown> = {
  openai: (res) => new OpenAIAdapter(cfg).mapResponse(res as never),
  anthropic: (res) => new AnthropicAdapter(cfg).mapResponse(res as never),
  gemini: (res) => new GeminiAdapter(cfg).mapResponse(res as never),
  copilot: (res) => new CopilotAdapter(cfg).mapResponse(res as never),
  local: (res) => new LocalAdapter(cfg).mapResponse(res as never),
};

/** Recursively key-sort then compact-stringify — the cross-language canonical form. */
function canonicalize(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

describe("polyglot parity (TS twin)", () => {
  it.each(manifest.map((c) => [c.id, c] as const))(
    "normalizes %s to the expected canonical UnifiedResponse",
    (_id, c) => {
      const recorded = JSON.parse(readFileSync(`${ROOT}${c.recorded}`, "utf8"));
      const normalize = normalizers[c.provider];
      expect(normalize, `no normalizer for provider "${c.provider}"`).toBeDefined();

      const got = canonicalize(normalize!(recorded.providerResponse));
      const want = canonicalize(
        JSON.parse(readFileSync(`${ROOT}${c.expected}`, "utf8")),
      );
      expect(got).toEqual(want);
    },
  );
});
