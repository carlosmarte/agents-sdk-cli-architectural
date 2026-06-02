import { fileURLToPath } from "node:url";

import { FakeProvider } from "@llmorch/core";
import { describe, expect, it } from "vitest";

import { resolveFlags } from "../src/flags.js";
import { run } from "../src/run.js";

const SCHEMA = fileURLToPath(new URL("./fixtures/schema.json", import.meta.url));

/** Capture a command's stdout/stderr while running it against an injected fake. */
async function runCapture(
  argv: string[],
  opts: { orchestrator?: FakeProvider; env?: NodeJS.ProcessEnv } = {},
) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    orchestrator: opts.orchestrator,
    env: opts.env ?? {},
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
  });
  return { code, out, err };
}

describe("@llmorch/cli commands (FakeProvider-backed)", () => {
  it("chat prints only the text answer", async () => {
    const { code, out } = await runCapture(["chat", "hello"], {
      orchestrator: new FakeProvider({ text: "The answer." }),
    });
    expect(code).toBe(0);
    expect(out.trimEnd()).toBe("The answer.");
  });

  it("stream concatenates streamed deltas into the full text", async () => {
    const { code, out } = await runCapture(["stream", "hello"], {
      orchestrator: new FakeProvider({ text: "HelloThere" }),
    });
    expect(code).toBe(0);
    expect(out).toBe("HelloThere");
  });

  it("structured reads the schema file and prints schema-valid JSON", async () => {
    const payload = { name: "Ada", age: 36 };
    const { code, out } = await runCapture(["structured", "extract", "--schema", SCHEMA], {
      orchestrator: new FakeProvider({ structured: payload }),
    });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual(payload);
  });

  it("structured exits non-zero on a missing schema file", async () => {
    const { code, err } = await runCapture(
      ["structured", "extract", "--schema", "/does/not/exist.json"],
      { orchestrator: new FakeProvider({ structured: {} }) },
    );
    expect(code).toBe(1);
    expect(err).toContain("schema file");
  });

  it("providers lists exactly the four real providers with resolved config", async () => {
    const { code, out } = await runCapture(["providers"], {
      env: { OPENAI_API_KEY: "sk-x" },
    });
    expect(code).toBe(0);
    const ids = out.trim().split("\n").map((line) => line.split("  ")[0]);
    expect(ids).toEqual(["anthropic", "copilot", "gemini", "openai"]);
    expect(out).toContain("openai  default_model=gpt-4o  key_present=true");
    expect(out).toContain("anthropic  default_model=claude-3-5-sonnet-latest  key_present=false");
  });

  it("flag precedence: explicit --provider overrides LLMORCH_PROVIDER", () => {
    const resolved = resolveFlags({ provider: "gemini" }, { LLMORCH_PROVIDER: "openai" });
    expect(resolved.provider).toBe("gemini");
  });

  it("flag precedence: env LLMORCH_PROVIDER applies when no flag is given", () => {
    const resolved = resolveFlags({}, { LLMORCH_PROVIDER: "openai" });
    expect(resolved.provider).toBe("openai");
  });

  it("numeric flags land on the resolved request shape", () => {
    const resolved = resolveFlags({ temperature: 0.2, "max-tokens": 64 }, {});
    expect(resolved.temperature).toBe(0.2);
    expect(resolved.maxTokens).toBe(64);
  });
});
