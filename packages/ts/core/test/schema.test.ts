import { describe, expect, it } from "vitest";
import { z } from "zod";

import { SchemaValidationError } from "../src/errors.js";
import { parseOrThrow, zodToJsonSchema } from "../src/schema.js";

describe("zodToJsonSchema", () => {
  it("emits a JSON Schema object with typed properties + required list", () => {
    const schema = z.object({ name: z.string().min(2), age: z.number().int() });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe("object");
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toMatchObject({ type: "string", minLength: 2 });
    expect(props.age).toMatchObject({ type: "integer" });
    expect(json.required).toEqual(["name", "age"]);
  });

  it("marks optional fields as not required and unwraps nested objects", () => {
    const schema = z.object({
      id: z.string(),
      nested: z.object({ flag: z.boolean() }).optional(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.required).toEqual(["id"]);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.nested.type).toBe("object");
  });
});

describe("parseOrThrow", () => {
  const Person = z.object({ name: z.string().min(2), age: z.number().int() });

  it("returns the typed value on a valid object", () => {
    expect(parseOrThrow(Person, { name: "Ada", age: 36 })).toEqual({
      name: "Ada",
      age: 36,
    });
  });

  it("raises SchemaValidationError when the data violates the schema", () => {
    expect(() => parseOrThrow(Person, { name: "A", age: 36 })).toThrow(
      SchemaValidationError,
    );
  });
});
