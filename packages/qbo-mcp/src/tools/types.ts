import type { z } from "zod";
import type { Config } from "../config.js";
import type { Store } from "../store.js";

export interface ToolContext {
  config: Config;
  store: Store;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  jsonSchema: object;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}

interface TypedToolDef<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  jsonSchema: object;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

export function tool<S extends z.ZodTypeAny>(def: TypedToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}
