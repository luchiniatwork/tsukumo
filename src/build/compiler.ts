/**
 * Bun compilation wrapper. See SPEC.md §5.1, §5.2.
 *
 * Wraps `bun build --compile` to produce standalone binaries for
 * specified target platforms. Each target produces a single binary
 * named `tsukumo-{target}` in the output directory.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Default compilation target. */
const DEFAULT_TARGET = "bun-linux-x64";

/** Options for the compilation step. */
export interface CompileOptions {
  /** Path to the generated CLI entry point source file. */
  entryPoint: string;

  /**
   * Bun compilation targets.
   * Defaults to `['bun-linux-x64']`.
   */
  targets?: string[];

  /**
   * Output directory for compiled binaries.
   * One binary per target, named: `tsukumo-{target}`
   */
  outDir: string;
}

/** Result of compiling a single target. */
export interface CompileResult {
  /** The Bun target string (e.g., `bun-linux-x64`). */
  target: string;
  /** Absolute path to the compiled binary. */
  outputPath: string;
}

/**
 * Compile a single target using `bun build --compile`.
 *
 * Spawns `bun build --compile --target=<target> <entryPoint> --outfile <outFile>`
 * and waits for completion. Throws on non-zero exit code.
 */
async function compileTarget(
  entryPoint: string,
  target: string,
  outDir: string,
): Promise<CompileResult> {
  const outputPath = join(outDir, `tsukumo-${target}`);

  const proc = Bun.spawn(
    [
      "bun",
      "build",
      "--compile",
      `--target=${target}`,
      entryPoint,
      "--outfile",
      outputPath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Compilation failed for target "${target}" (exit code ${exitCode}):\n${stderr}`,
    );
  }

  return { target, outputPath };
}

/**
 * Compile the CLI entry point into standalone binaries using
 * `bun build --compile --target=<target>`.
 *
 * Creates the output directory if it doesn't exist, then compiles
 * the entry point for each specified target. Targets are compiled
 * sequentially to avoid resource contention.
 *
 * Returns the list of successfully compiled targets and their output
 * paths.
 */
export async function compile(
  options: CompileOptions,
): Promise<CompileResult[]> {
  const targets = options.targets ?? [DEFAULT_TARGET];

  // Ensure output directory exists
  await mkdir(options.outDir, { recursive: true });

  const results: CompileResult[] = [];

  for (const target of targets) {
    const result = await compileTarget(options.entryPoint, target, options.outDir);
    results.push(result);
  }

  return results;
}
