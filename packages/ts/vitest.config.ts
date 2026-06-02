import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    // The polyglot parity harness is a separate cross-language gate (Feature 07,
    // Story 03) run via `make parity`, not part of the fast per-package suite —
    // keep it out of the default `make test` / `make ci` run.
    exclude: ["**/node_modules/**", "**/dist/**", "**/parity/**"],
    environment: "node",
  },
});
