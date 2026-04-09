/**
 * Host-side watcher and handler executor. See SPEC.md §8.
 *
 * Watches the sandbox's requests/ directory for new `.json` files,
 * executes the corresponding tool handler, and writes the response
 * using the atomic write protocol (§7.4).
 */

import type { SandboxBackend } from "../backends/interface.ts";
import type { Tool } from "../define.ts";

/** Options for the host runtime. */
export interface HostRuntimeOptions {
  /** The sandbox backend to use for filesystem operations. */
  backend: SandboxBackend;

  /** Registered tools indexed by name. */
  tools: Map<string, Tool>;

  /** Base path inside the sandbox. */
  basePath: string;

  /**
   * Reconciliation poll interval in milliseconds.
   * Defaults to 500ms. See SPEC.md §8.1.
   */
  pollInterval?: number;

  /**
   * Maximum concurrent handler executions.
   * Defaults to Infinity (no limit).
   */
  maxConcurrency?: number;
}

export interface HostRuntimeHandle {
  /** Stop the watcher and clean up. */
  dispose(): Promise<void>;
}

/**
 * Start the host-side runtime: watches for request files and
 * executes tool handlers.
 */
export async function startHostRuntime(
  _options: HostRuntimeOptions,
): Promise<HostRuntimeHandle> {
  // TODO: implement watcher + handler executor
  throw new Error("Not implemented");
}
