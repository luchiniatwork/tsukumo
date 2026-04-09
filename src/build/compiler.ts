/**
 * Bun compilation wrapper. See SPEC.md §5.1, §5.2.
 *
 * Wraps `bun build --compile` to produce standalone binaries for
 * specified target platforms.
 */

/** Options for the compilation step. */
export interface CompileOptions {
  /** Path to the generated CLI entry point source file. */
  entryPoint: string;

  /**
   * Bun compilation targets.
   * Defaults to `['bun-linux-x64']`.
   */
  targets: string[];

  /**
   * Output directory for compiled binaries.
   * One binary per target, named: `tsukumo-{target}`
   */
  outDir: string;
}

/**
 * Compile the CLI entry point into standalone binaries using
 * `bun build --compile --target=<target>`.
 */
export async function compile(_options: CompileOptions): Promise<void> {
  // TODO: implement Bun compilation
  throw new Error("Not implemented");
}
