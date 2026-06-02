import { FakeProvider } from "@llmorch/core";
import { describe, expect, it } from "vitest";

import { run } from "../src/run.js";

/**
 * The Hexagonal anti-drift property: a command handler driven through `run` (with
 * a FakeProvider-backed orchestrator injected via `deps`) renders exactly what
 * calling `orchestrator.chat(...)` directly returns — no logic lives in the CLI.
 */
describe("@llmorch/cli run — handler ↔ orchestrator parity", () => {
  it("chat handler output equals orchestrator.chat() for the same request", async () => {
    const orchestrator = new FakeProvider({ text: "Parity answer." });
    let out = "";
    const code = await run(["chat", "hi"], {
      orchestrator,
      stdout: (s) => (out += s),
      stderr: () => {},
      env: {},
    });

    const direct = await orchestrator.chat({
      model: "default",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(code).toBe(0);
    expect(out.trimEnd()).toBe(direct.text);
  });

  it("--help exits 0 and lists every command without a handler import", async () => {
    let out = "";
    const code = await run(["--help"], { stdout: (s) => (out += s), env: {} });
    expect(code).toBe(0);
    for (const name of ["chat", "stream", "structured", "providers"]) {
      expect(out).toContain(name);
    }
  });

  it("an unknown command exits non-zero and prints the command list", async () => {
    let err = "";
    const code = await run(["bogus"], { stderr: (s) => (err += s), stdout: () => {}, env: {} });
    expect(code).toBe(1);
    expect(err).toContain("Unknown command: bogus");
    expect(err).toContain("chat");
  });
});
