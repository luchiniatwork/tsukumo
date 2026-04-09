/**
 * tsukumo — tools for sandboxes.
 *
 * Public API surface. See SPEC.md §4, §10.1.
 *
 * @example
 * ```ts
 * import { defineTool, createToolbox } from 'tsukumo';
 * import { z } from 'zod';
 *
 * const echo = defineTool({
 *   name: 'echo',
 *   description: 'Echoes the input back',
 *   args: z.object({ message: z.string() }),
 *   handler: async ({ message }) => ({ echoed: message }),
 * });
 *
 * const toolbox = createToolbox({ tools: [echo] });
 * ```
 */

// Core API
export { defineTool } from "./define.ts";
export { createToolbox } from "./toolbox.ts";

// Types
export type { Tool, ToolDefinition } from "./define.ts";
export type {
  Toolbox,
  ToolboxConfig,
  BuildOptions,
  InjectOptions,
  InjectionHandle,
} from "./toolbox.ts";

// Protocol types
export type {
  ToolRequest,
  ToolResponse,
  ToolResponseSuccess,
  ToolResponseError,
  ErrorCode,
} from "./protocol.ts";
export { PROTOCOL_VERSION, DEFAULT_BASE_PATH } from "./protocol.ts";

// Backend interface (for custom implementations)
export type {
  SandboxBackend,
  WatchEvent,
  ExecResult,
  Disposable,
} from "./backends/interface.ts";

// E2B adapter
export { createE2BBackend } from "./backends/e2b.ts";
export type { E2BSandbox } from "./backends/e2b.ts";
