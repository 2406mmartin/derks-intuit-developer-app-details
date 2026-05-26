import { z } from "zod";

export function schemaToJson(node: z.ZodTypeAny): object {
  return walk(node);
}

function walk(node: z.ZodTypeAny): object {
  if (node instanceof z.ZodObject) {
    const shape = node.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, object> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = walk(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    const out: Record<string, unknown> = {
      type: "object",
      properties,
      additionalProperties: false,
    };
    if (required.length) out.required = required;
    return out;
  }
  if (node instanceof z.ZodOptional) return walk(node._def.innerType);
  if (node instanceof z.ZodDefault) {
    const inner = walk(node._def.innerType) as Record<string, unknown>;
    inner.default = node._def.defaultValue();
    if (node.description && !inner.description) inner.description = node.description;
    return inner;
  }
  if (node instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    if (node.description) out.description = node.description;
    return out;
  }
  if (node instanceof z.ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    if (node.description) out.description = node.description;
    return out;
  }
  if (node instanceof z.ZodBoolean) {
    const out: Record<string, unknown> = { type: "boolean" };
    if (node.description) out.description = node.description;
    return out;
  }
  if (node instanceof z.ZodEnum) {
    const out: Record<string, unknown> = { type: "string", enum: node.options };
    if (node.description) out.description = node.description;
    return out;
  }
  if (node instanceof z.ZodArray) {
    const out: Record<string, unknown> = {
      type: "array",
      items: walk(node._def.type),
    };
    if (node.description) out.description = node.description;
    return out;
  }
  if (node instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: walk(node._def.valueType) };
  }
  if (node instanceof z.ZodUnion) {
    return { anyOf: node._def.options.map((o: z.ZodTypeAny) => walk(o)) };
  }
  if (node instanceof z.ZodLiteral) {
    return { const: node._def.value };
  }
  if (node instanceof z.ZodNullable) {
    return { anyOf: [walk(node._def.innerType), { type: "null" }] };
  }
  return {};
}
