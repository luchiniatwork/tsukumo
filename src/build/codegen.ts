/**
 * CLI entry point code generation. See SPEC.md §5.2.
 *
 * Generates a temporary TypeScript file that imports all tool schemas
 * and wires up the argument parsing and request/response protocol.
 * This generated file is then compiled with `bun build --compile`.
 */

import type { Tool } from "../define.ts";

/**
 * Generate the CLI entry point source code for the compiled stub binary.
 *
 * The generated code:
 * - Imports tool schemas (NOT handlers — handlers stay host-side)
 * - Sets up the busybox pattern (argv[0] detection + subcommands)
 * - Wires argument parsing via zod-opts
 * - Implements the request/response file protocol
 */
export function generateCliEntryPoint(_tools: Tool[]): string {
  // TODO: implement code generation
  throw new Error("Not implemented");
}
