/**
 * Toolbox — collection of tools with build and inject capabilities.
 * See SPEC.md §4.3, §5.1, §6.1.
 */

import type { Tool } from "./define.ts";

/** Configuration for `createToolbox()`. */
export interface ToolboxConfig {
  /** The tools in this toolbox. */
  tools: Tool[];

  /**
   * Base path inside the sandbox where tsukumo files are placed.
   * Defaults to '/tmp/tsukumo'.
   */
  basePath?: string;

  /**
   * Maximum concurrent handler executions.
   * Defaults to Infinity (no limit). See SPEC.md §8.2.
   */
  maxConcurrency?: number;
}

/** Options for the build step. */
export interface BuildOptions {
  /**
   * Bun compilation targets.
   * Defaults to `['bun-linux-x64']`.
   */
  targets?: string[];

  /**
   * Output directory for compiled binaries.
   * One binary per target, named: `tsukumo-{target}`
   */
  outDir?: string;
}

/** Options for injection into a sandbox. */
export interface InjectOptions {
  /**
   * Which pre-built target to inject.
   * Must match a target from the build step.
   * Defaults to 'bun-linux-x64'.
   */
  target?: string;

  /**
   * Add /tsukumo/bin to the sandbox PATH.
   * Defaults to true.
   */
  addToPath?: boolean;
}

/** Handle returned by `inject()` for cleanup. */
export interface InjectionHandle {
  /** Stops watcher and optionally removes injected files. */
  dispose(): Promise<void>;
}

/** A toolbox with build and inject capabilities. */
export interface Toolbox {
  /** The tools in this toolbox. */
  readonly tools: ReadonlyArray<Tool>;

  /** Build the stub binary for the given targets. */
  build(options?: BuildOptions): Promise<void>;

  /** Inject tools into a sandbox and start watching for requests. */
  inject(sandbox: unknown, options?: InjectOptions): Promise<InjectionHandle>;
}

/**
 * Create a toolbox from a collection of tools.
 *
 * ```ts
 * const toolbox = createToolbox({
 *   tools: [greet, fetchUrl, runQuery],
 *   basePath: '/tmp/tsukumo',
 * });
 * ```
 */
export function createToolbox(_config: ToolboxConfig): Toolbox {
  // TODO: implement createToolbox
  throw new Error("Not implemented");
}
