/**
 * Tests for Bun compiler wrapper (src/build/compiler.ts).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { compile } from "./compiler.ts";

/** Temp dir outside the project — for tests that don't need node_modules. */
const TEST_DIR = join(tmpdir(), `tsukumo-compiler-test-${Date.now()}`);

/** Temp dir inside the project — for tests that import npm packages. */
const PROJECT_TEST_DIR = resolve(
  import.meta.dir,
  "../../.test-compiler-tmp",
);

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(PROJECT_TEST_DIR, { recursive: true, force: true });
});

describe("compile", () => {
  test("compiles a trivial entry point for the current platform", async () => {
    const srcDir = join(TEST_DIR, "simple");
    const outDir = join(TEST_DIR, "simple-out");
    await mkdir(srcDir, { recursive: true });

    const entryPoint = join(srcDir, "entry.ts");
    await writeFile(
      entryPoint,
      'console.log("hello from stub");',
    );

    const results = await compile({
      entryPoint,
      targets: ["bun-linux-x64"],
      outDir,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.target).toBe("bun-linux-x64");
    expect(results[0]!.outputPath).toBe(join(outDir, "tsukumo-bun-linux-x64"));
    expect(existsSync(results[0]!.outputPath)).toBe(true);
  }, 30_000);

  test("creates output directory if it doesn't exist", async () => {
    const srcDir = join(TEST_DIR, "mkdir");
    const outDir = join(TEST_DIR, "mkdir-out", "nested", "dir");
    await mkdir(srcDir, { recursive: true });

    const entryPoint = join(srcDir, "entry.ts");
    await writeFile(entryPoint, "export {};");

    await compile({
      entryPoint,
      targets: ["bun-linux-x64"],
      outDir,
    });

    expect(existsSync(outDir)).toBe(true);
    expect(existsSync(join(outDir, "tsukumo-bun-linux-x64"))).toBe(true);
  }, 30_000);

  test("defaults to bun-linux-x64 target when targets omitted", async () => {
    const srcDir = join(TEST_DIR, "defaults");
    const outDir = join(TEST_DIR, "defaults-out");
    await mkdir(srcDir, { recursive: true });

    const entryPoint = join(srcDir, "entry.ts");
    await writeFile(entryPoint, "export {};");

    const results = await compile({
      entryPoint,
      outDir,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.target).toBe("bun-linux-x64");
  }, 30_000);

  test("throws on invalid entry point", async () => {
    const outDir = join(TEST_DIR, "invalid-out");

    await expect(
      compile({
        entryPoint: "/nonexistent/file.ts",
        targets: ["bun-linux-x64"],
        outDir,
      }),
    ).rejects.toThrow(/Compilation failed/);
  }, 30_000);

  test("compiles a file that imports zod", async () => {
    const srcDir = join(PROJECT_TEST_DIR, "with-zod");
    const outDir = join(PROJECT_TEST_DIR, "with-zod-out");
    await mkdir(srcDir, { recursive: true });

    const entryPoint = join(srcDir, "entry.ts");
    await writeFile(
      entryPoint,
      [
        'import { z } from "zod";',
        "const schema = z.object({ name: z.string() });",
        'console.log(JSON.stringify(schema.parse({ name: "test" })));',
      ].join("\n"),
    );

    const results = await compile({
      entryPoint,
      targets: ["bun-linux-x64"],
      outDir,
    });

    expect(results).toHaveLength(1);
    expect(existsSync(results[0]!.outputPath)).toBe(true);
  }, 30_000);
});
