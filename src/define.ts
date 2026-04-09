/**
 * Tool definition API. See SPEC.md §4 for details.
 */

import type { z } from "zod";

/**
 * Configuration passed to `defineTool()`.
 * See SPEC.md §4.2 for the full interface.
 */
export interface ToolDefinition<
  TArgs extends z.ZodObject<z.ZodRawShape>,
  TResult,
> {
  /** Unique tool name. Used as CLI command name and symlink name. */
  name: string;

  /** Human-readable description. Shown in --help output. */
  description: string;

  /** Zod schema for the tool's arguments. Must be a z.object(). */
  args: TArgs;

  /**
   * Handler function executed on the HOST side.
   * Receives validated, typed arguments.
   * Returns a JSON-serializable value.
   */
  handler: (args: z.infer<TArgs>) => Promise<TResult> | TResult;

  /**
   * Optional timeout in milliseconds for the handler.
   * Defaults to 30_000 (30 seconds).
   */
  timeout?: number;
}

/** Default handler timeout in milliseconds. */
export const DEFAULT_HANDLER_TIMEOUT = 30_000;

/**
 * A fully defined tool — the return type of `defineTool()`.
 *
 * The `handler` is kept as a separate, tree-shakeable property so the
 * build step can exclude handler code from the compiled stub binary
 * (SPEC.md §5.4).
 */
export interface Tool<
  TArgs extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  TResult = unknown,
> {
  readonly name: string;
  readonly description: string;
  readonly args: TArgs;
  readonly handler: (args: z.infer<TArgs>) => Promise<TResult> | TResult;
  readonly timeout: number;
}

/**
 * Define a tool with typed arguments and a handler.
 *
 * ```ts
 * const greet = defineTool({
 *   name: 'greet',
 *   description: 'Greets a person by name',
 *   args: z.object({ name: z.string() }),
 *   handler: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
 * });
 * ```
 */
export function defineTool<
  TArgs extends z.ZodObject<z.ZodRawShape>,
  TResult,
>(def: ToolDefinition<TArgs, TResult>): Tool<TArgs, TResult> {
  return {
    name: def.name,
    description: def.description,
    args: def.args,
    handler: def.handler,
    timeout: def.timeout ?? DEFAULT_HANDLER_TIMEOUT,
  };
}
