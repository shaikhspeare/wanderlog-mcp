import { z, type ZodTypeAny } from "zod";

/**
 * Minimal Zod-shape → Anthropic-tool-input-schema converter.
 *
 * Our MCP tools export a "ZodRawShape" — a plain object mapping field
 * name to a ZodType. We walk it, handling the subset of zod nodes we
 * actually use: ZodString, ZodEnum, ZodOptional, ZodDefault, ZodBoolean,
 * ZodNumber, ZodArray, and string-valued `.describe(...)` metadata.
 *
 * Anything fancier and this function will throw with a clear error so
 * the next person to add a tool schema can either extend this or switch
 * to zod-to-json-schema. We keep it inline to avoid a dep for such a
 * small surface.
 */

type JsonSchema = {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

export type AnthropicToolInputSchema = {
  type: "object";
  properties: Record<string, JsonSchema>;
  required: string[];
  additionalProperties?: boolean;
};

export function zodShapeToInputSchema(
  shape: Record<string, ZodTypeAny>,
): AnthropicToolInputSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [name, field] of Object.entries(shape)) {
    const { schema, isRequired } = convertField(field);
    properties[name] = schema;
    if (isRequired) required.push(name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function convertField(node: ZodTypeAny): {
  schema: JsonSchema;
  isRequired: boolean;
} {
  let current: ZodTypeAny = node;
  let isRequired = true;
  let defaultValue: unknown;
  let description: string | undefined = node.description;

  // Walk the wrapper types (Optional, Default) until we hit a "real" node.
  // Each wrapper carries its own description; inner wins if set.
  while (true) {
    const def = (current as unknown as { _def: { typeName: string } })._def;
    if (def.typeName === "ZodOptional") {
      isRequired = false;
      current = (current as unknown as { unwrap(): ZodTypeAny }).unwrap();
      if (current.description && !description) description = current.description;
      continue;
    }
    if (def.typeName === "ZodDefault") {
      isRequired = false;
      const defDef = def as unknown as {
        defaultValue: () => unknown;
        innerType: ZodTypeAny;
      };
      defaultValue = defDef.defaultValue();
      current = defDef.innerType;
      if (current.description && !description) description = current.description;
      continue;
    }
    break;
  }

  const schema = convertLeaf(current);
  if (description) schema.description = description;
  if (defaultValue !== undefined) schema.default = defaultValue;

  return { schema, isRequired };
}

function convertLeaf(node: ZodTypeAny): JsonSchema {
  const def = (node as unknown as { _def: { typeName: string } })._def;
  switch (def.typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum": {
      const enumDef = def as unknown as { values: string[] };
      return { type: "string", enum: enumDef.values };
    }
    case "ZodArray": {
      const arrDef = def as unknown as { type: ZodTypeAny };
      return { type: "array", items: convertLeaf(arrDef.type) };
    }
    case "ZodObject": {
      // Nested object — reuse the shape walker.
      const objDef = def as unknown as {
        shape: () => Record<string, ZodTypeAny>;
      };
      const nested = zodShapeToInputSchema(objDef.shape());
      return nested;
    }
    default:
      throw new Error(
        `evals/schema.ts: unsupported zod type "${def.typeName}". Extend convertLeaf() or switch to zod-to-json-schema.`,
      );
  }
}

/** Dev guard — smoke-compile the top-level runtime so unused zod import is still referenced. */
export const __zodSmoke = z.object({}).optional();
