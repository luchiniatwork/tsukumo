/**
 * Bridge from Zod z.object() shapes to zod-opts .options() format.
 * See SPEC.md §9.1.
 */

import type { z } from "zod";

/**
 * Convert a Zod object shape to zod-opts options format.
 *
 * This is the thin bridge described in the spec:
 * ```ts
 * function zodShapeToOpts(shape: z.ZodRawShape) {
 *   return Object.fromEntries(
 *     Object.entries(shape).map(([key, zodType]) => [key, { type: zodType }])
 *   );
 * }
 * ```
 */
export function zodShapeToOpts(
  shape: z.ZodRawShape,
): Record<string, { type: z.ZodTypeAny }> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, zodType]) => [key, { type: zodType }]),
  );
}
