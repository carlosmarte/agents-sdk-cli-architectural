import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  OrchestrationError,
  ProviderError,
  RateLimitError,
  SchemaValidationError,
  TimeoutError,
  ToolExecutionError,
  UnsupportedFeatureError,
} from "../src/errors.js";

const subclasses = [
  ProviderError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  SchemaValidationError,
  ToolExecutionError,
  UnsupportedFeatureError,
];

describe("error taxonomy", () => {
  it("every subclass is an OrchestrationError and an Error", () => {
    for (const Cls of subclasses) {
      const e = new Cls("boom");
      expect(e instanceof OrchestrationError).toBe(true);
      expect(e instanceof Error).toBe(true);
    }
  });

  it("sets name to the concrete class name", () => {
    expect(new RateLimitError("m").name).toBe("RateLimitError");
  });

  it("preserves cause on ProviderError", () => {
    const original = new Error("root");
    const e = new ProviderError("wrapped", {
      providerId: "openai",
      cause: original,
    });
    expect(e.cause).toBe(original);
    expect(e.providerId).toBe("openai");
  });

  it("is catchable via the base type", () => {
    const run = (): never => {
      throw new TimeoutError("slow");
    };
    try {
      run();
    } catch (e) {
      expect(e instanceof OrchestrationError).toBe(true);
    }
  });
});
