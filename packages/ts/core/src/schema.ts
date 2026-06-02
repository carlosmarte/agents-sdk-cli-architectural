/**
 * Schema translation + validation helpers shared by every adapter's
 * `generateStructured`. The high-level Zod schema is translated to a low-level
 * JSON Schema for the provider's native enforcement, and the provider's JSON is
 * always validated against the ORIGINAL Zod schema before it is returned — so
 * constraints a provider silently drops (e.g. Anthropic strips `minLength` /
 * `maxLength` / regex) are still enforced locally.
 *
 * This is a focused, dependency-free converter rather than a wrapper around
 * `zod-to-json-schema`: the repo pins zero runtime deps beyond `zod`, the team
 * enforces install-time release cooldowns, and the modalities are verified only
 * against mocked providers, so a small in-tree converter is preferable to a new
 * supply-chain edge.
 */
import type { ZodType, ZodTypeAny } from "zod";

import { SchemaValidationError } from "./errors.js";

/** A plain JSON Schema object (intentionally loose — providers accept a subset). */
export type JsonSchema = Record<string, unknown>;

/** Read the internal zod type tag (stable for zod 3.x). */
function typeName(schema: ZodTypeAny): string {
  return (schema._def as { typeName?: string }).typeName ?? "";
}

/** Unwrap optional/nullable/default/effects wrappers to the inner schema. */
function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean } {
  let inner = schema;
  let optional = false;
  // Peel wrappers until we reach a concrete type.
  for (;;) {
    const name = typeName(inner);
    const def = inner._def as { innerType?: ZodTypeAny; schema?: ZodTypeAny };
    if (name === "ZodOptional" || name === "ZodDefault" || name === "ZodNullable") {
      if (name !== "ZodNullable") optional = true;
      inner = def.innerType as ZodTypeAny;
      continue;
    }
    if (name === "ZodEffects") {
      inner = def.schema as ZodTypeAny;
      continue;
    }
    break;
  }
  return { inner, optional };
}

interface StringCheck {
  kind: string;
  value?: number;
  regex?: RegExp;
}

/** Translate a single (already-unwrapped) zod type to JSON Schema. */
function convert(schema: ZodTypeAny): JsonSchema {
  const name = typeName(schema);
  switch (name) {
    case "ZodObject": {
      const shape = (schema._def as { shape: () => Record<string, ZodTypeAny> }).shape();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        const { inner, optional } = unwrap(child);
        properties[key] = convert(inner);
        if (!optional) required.push(key);
      }
      const out: JsonSchema = { type: "object", properties };
      if (required.length > 0) out.required = required;
      out.additionalProperties = false;
      return out;
    }
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      for (const c of (schema._def as { checks: StringCheck[] }).checks ?? []) {
        if (c.kind === "min" && c.value !== undefined) out.minLength = c.value;
        if (c.kind === "max" && c.value !== undefined) out.maxLength = c.value;
        if (c.kind === "regex" && c.regex) out.pattern = c.regex.source;
      }
      return out;
    }
    case "ZodNumber": {
      const checks = (schema._def as { checks: StringCheck[] }).checks ?? [];
      const isInt = checks.some((c) => c.kind === "int");
      const out: JsonSchema = { type: isInt ? "integer" : "number" };
      for (const c of checks) {
        if (c.kind === "min" && c.value !== undefined) out.minimum = c.value;
        if (c.kind === "max" && c.value !== undefined) out.maximum = c.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray": {
      const item = (schema._def as { type: ZodTypeAny }).type;
      return { type: "array", items: convert(unwrap(item).inner) };
    }
    case "ZodEnum": {
      const values = (schema._def as { values: string[] }).values;
      return { type: "string", enum: values };
    }
    case "ZodLiteral": {
      const value = (schema._def as { value: unknown }).value;
      return { const: value };
    }
    default:
      // Unknown/uncovered construct — emit a permissive object so the provider
      // does not reject the request; local validation still enforces the schema.
      return {};
  }
}

/**
 * Translate a Zod schema to a low-level JSON Schema object suitable for a
 * provider's structured-output enforcement (`response_format` / `input_schema` /
 * `responseSchema`).
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(unwrap(schema).inner);
}

/**
 * Validate provider JSON against the ORIGINAL schema, returning the typed value
 * or raising a {@link SchemaValidationError}. This is the single final step every
 * adapter's `generateStructured` shares.
 */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new SchemaValidationError(
      `Structured output failed schema validation: ${result.error.message}`,
      { cause: result.error },
    );
  }
  return result.data;
}
