/**
 * Minimal JSON-Schema → Zod converter for the `structured` command. The
 * orchestrator's `generateStructured` enforces output against a Zod schema, but
 * the CLI accepts a JSON Schema file from `--schema`; this is the bridge. It is
 * the inverse of `@llmorch/core`'s in-tree `zodToJsonSchema` and covers the same
 * subset (object/string/number/integer/boolean/array/enum + `required`) — kept
 * dependency-free in line with the repo's zero-extra-runtime-deps policy.
 */
import { z, type ZodTypeAny } from "zod";

interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: unknown[];
}

export function jsonSchemaToZod(schema: JsonSchemaNode): ZodTypeAny {
  if (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === "string")) {
    return z.enum(schema.enum as [string, ...string[]]);
  }
  switch (schema.type) {
    case "object": {
      const required = new Set(schema.required ?? []);
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        const inner = jsonSchemaToZod(child);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      return z.object(shape);
    }
    case "string":
      return z.string();
    case "integer":
      return z.number().int();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(schema.items ? jsonSchemaToZod(schema.items) : z.unknown());
    default:
      return z.unknown();
  }
}
