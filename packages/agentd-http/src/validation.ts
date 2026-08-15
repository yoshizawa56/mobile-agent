import { validator } from "hono/validator";
import type { ValidationTargets } from "hono/types";
import { z } from "zod";

type ValidationTarget = keyof ValidationTargets;

/** One shared Zod/Hono boundary for all route input. */
export function validate<TTarget extends ValidationTarget, TSchema extends z.ZodTypeAny>(target: TTarget, schema: TSchema) {
  return validator(target, (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    return parsed.data;
  });
}
