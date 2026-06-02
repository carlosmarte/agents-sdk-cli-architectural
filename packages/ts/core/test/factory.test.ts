import { describe, expect, it } from "vitest";

import type { ProviderConfig } from "../src/config.js";
import { UnknownProviderError } from "../src/errors.js";
import {
  LLMFactory,
  registerProvider,
  registeredProviders,
} from "../src/factory.js";
import { FakeProvider } from "./fixtures/fake-provider.js";

const cfg = (provider: string): ProviderConfig =>
  ({ provider, apiKey: "k" }) as unknown as ProviderConfig;

describe("LLMFactory", () => {
  it("resolves a registered id to an LLMProvider instance", () => {
    registerProvider("fake", FakeProvider);
    const provider = LLMFactory.create(cfg("fake"));
    expect(provider).toBeInstanceOf(FakeProvider);
    expect(registeredProviders()).toContain("fake");
  });

  it("throws UnknownProviderError naming the bad id for an unknown provider", () => {
    expect(() => LLMFactory.create(cfg("nope"))).toThrow(UnknownProviderError);
    try {
      LLMFactory.create(cfg("nope"));
    } catch (err) {
      expect((err as Error).message).toContain("nope");
    }
  });

  it("re-registration is last-write-wins", () => {
    class A extends FakeProvider {}
    class B extends FakeProvider {}
    registerProvider("dup", A);
    registerProvider("dup", B);
    expect(LLMFactory.create(cfg("dup"))).toBeInstanceOf(B);
  });
});
