/**
 * Tests for CLI entry point code generation (src/build/codegen.ts).
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { defineTool } from "../define.ts";
import { zodTypeToCode, generateCliEntryPoint } from "./codegen.ts";

// ─── zodTypeToCode ──────────────────────────────────────────────────

describe("zodTypeToCode", () => {
  /**
   * Helper: evaluates generated code and returns the Zod schema.
   * Uses `new Function` to avoid eval in strict mode.
   */
  function evalZodCode(code: string): z.ZodTypeAny {
    const fn = new Function("z", `return ${code};`);
    return fn(z) as z.ZodTypeAny;
  }

  // ── Core types ──

  test("z.string()", () => {
    const code = zodTypeToCode(z.string());
    expect(code).toBe("z.string()");

    const schema = evalZodCode(code);
    expect(schema.parse("hello")).toBe("hello");
    expect(() => schema.parse(123)).toThrow();
  });

  test("z.number()", () => {
    const code = zodTypeToCode(z.number());
    expect(code).toBe("z.number()");

    const schema = evalZodCode(code);
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse("abc")).toThrow();
  });

  test("z.boolean()", () => {
    const code = zodTypeToCode(z.boolean());
    expect(code).toBe("z.boolean()");

    const schema = evalZodCode(code);
    expect(schema.parse(true)).toBe(true);
    expect(() => schema.parse("yes")).toThrow();
  });

  test("z.enum([...])", () => {
    const code = zodTypeToCode(z.enum(["a", "b", "c"]));
    expect(code).toBe('z.enum(["a","b","c"])');

    const schema = evalZodCode(code);
    expect(schema.parse("a")).toBe("a");
    expect(() => schema.parse("d")).toThrow();
  });

  test("z.array(z.string())", () => {
    const code = zodTypeToCode(z.array(z.string()));
    expect(code).toBe("z.array(z.string())");

    const schema = evalZodCode(code);
    expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(() => schema.parse([1, 2])).toThrow();
  });

  test("z.array(z.number())", () => {
    const code = zodTypeToCode(z.array(z.number()));
    expect(code).toBe("z.array(z.number())");
  });

  // ── Modifiers ──

  test(".optional()", () => {
    const code = zodTypeToCode(z.string().optional());
    expect(code).toBe("z.string().optional()");

    const schema = evalZodCode(code);
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse("hi")).toBe("hi");
  });

  test(".default(value)", () => {
    const code = zodTypeToCode(z.number().default(42));
    expect(code).toBe("z.number().default(42)");

    const schema = evalZodCode(code);
    expect(schema.parse(undefined)).toBe(42);
    expect(schema.parse(7)).toBe(7);
  });

  test(".default(string)", () => {
    const code = zodTypeToCode(z.string().default("hello"));
    expect(code).toBe('z.string().default("hello")');
  });

  test(".default(boolean)", () => {
    const code = zodTypeToCode(z.boolean().default(false));
    expect(code).toBe("z.boolean().default(false)");
  });

  test('.describe("text")', () => {
    const code = zodTypeToCode(z.string().describe("A name"));
    expect(code).toBe('z.string().describe("A name")');

    const schema = evalZodCode(code);
    expect(schema.description).toBe("A name");
  });

  test("chained modifiers: describe + default + optional", () => {
    const code = zodTypeToCode(
      z.string().describe("Name").default("world").optional(),
    );
    expect(code).toBe(
      'z.string().describe("Name").default("world").optional()',
    );
  });

  // ── Number refinements ──

  test("z.number().int()", () => {
    const code = zodTypeToCode(z.number().int());
    expect(code).toBe("z.number().int()");

    const schema = evalZodCode(code);
    expect(schema.parse(5)).toBe(5);
    expect(() => schema.parse(5.5)).toThrow();
  });

  test("z.number().min(1).max(10)", () => {
    const code = zodTypeToCode(z.number().min(1).max(10));
    expect(code).toBe("z.number().min(1).max(10)");

    const schema = evalZodCode(code);
    expect(schema.parse(5)).toBe(5);
    expect(() => schema.parse(0)).toThrow();
    expect(() => schema.parse(11)).toThrow();
  });

  test("z.number().gt(0).lt(100)", () => {
    const code = zodTypeToCode(z.number().gt(0).lt(100));
    expect(code).toBe("z.number().gt(0).lt(100)");

    const schema = evalZodCode(code);
    expect(schema.parse(50)).toBe(50);
    expect(() => schema.parse(0)).toThrow();
    expect(() => schema.parse(100)).toThrow();
  });

  test("z.number().int().min(1).max(10)", () => {
    const code = zodTypeToCode(z.number().int().min(1).max(10));
    expect(code).toBe("z.number().int().min(1).max(10)");
  });

  test("z.number().multipleOf(5)", () => {
    const code = zodTypeToCode(z.number().multipleOf(5));
    expect(code).toBe("z.number().multipleOf(5)");

    const schema = evalZodCode(code);
    expect(schema.parse(10)).toBe(10);
    expect(() => schema.parse(7)).toThrow();
  });

  // ── String refinements ──

  test("z.string().min(3).max(10)", () => {
    const code = zodTypeToCode(z.string().min(3).max(10));
    expect(code).toBe("z.string().min(3).max(10)");

    const schema = evalZodCode(code);
    expect(schema.parse("hello")).toBe("hello");
    expect(() => schema.parse("hi")).toThrow();
    expect(() => schema.parse("a".repeat(11))).toThrow();
  });

  // ── Array refinements ──

  test("z.array(z.string()).min(1).max(5)", () => {
    const code = zodTypeToCode(z.array(z.string()).min(1).max(5));
    expect(code).toBe("z.array(z.string()).min(1).max(5)");

    const schema = evalZodCode(code);
    expect(schema.parse(["a"])).toEqual(["a"]);
    expect(() => schema.parse([])).toThrow();
    expect(() => schema.parse(["1", "2", "3", "4", "5", "6"])).toThrow();
  });

  // ── Unsupported types ──

  test("throws for unsupported types", () => {
    expect(() => zodTypeToCode(z.date())).toThrow(
      /Unsupported Zod type.*ZodDate/,
    );
    expect(() => zodTypeToCode(z.null())).toThrow(
      /Unsupported Zod type.*ZodNull/,
    );
  });

  // ── Description on wrapper types ──

  test("description on inner type preserved through .optional()", () => {
    const code = zodTypeToCode(z.string().describe("inner desc").optional());
    expect(code).toBe('z.string().describe("inner desc").optional()');
  });

  test("description on wrapper type itself", () => {
    const code = zodTypeToCode(z.string().optional().describe("outer desc"));
    expect(code).toBe('z.string().optional().describe("outer desc")');
  });
});

// ─── generateCliEntryPoint ──────────────────────────────────────────

describe("generateCliEntryPoint", () => {
  const greet = defineTool({
    name: "greet",
    description: "Greets a person",
    args: z.object({
      name: z.string().describe("Person's name"),
      enthusiasm: z.number().int().min(1).max(10).default(5),
    }),
    handler: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
  });

  const echo = defineTool({
    name: "echo",
    description: "Echoes input back",
    args: z.object({
      message: z.string().describe("Message to echo"),
    }),
    handler: ({ message }) => ({ echoed: message }),
  });

  test("generates syntactically valid TypeScript", () => {
    const source = generateCliEntryPoint([greet, echo]);
    // Should not throw during transpilation
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const js = transpiler.transformSync(source);
    expect(js).toBeTruthy();
  });

  test("includes tool schemas in the output", () => {
    const source = generateCliEntryPoint([greet, echo]);
    expect(source).toContain('"greet"');
    expect(source).toContain('"echo"');
    expect(source).toContain("Greets a person");
    expect(source).toContain("Echoes input back");
  });

  test("includes inline Zod schema code for each tool", () => {
    const source = generateCliEntryPoint([greet]);
    expect(source).toContain('z.string().describe("Person\'s name")');
    expect(source).toContain("z.number().int().min(1).max(10).default(5)");
  });

  test("includes protocol constants", () => {
    const source = generateCliEntryPoint([greet]);
    expect(source).toContain("PROTOCOL_VERSION = 1");
    expect(source).toContain('BASE_PATH = "/tmp/tsukumo"');
  });

  test("respects custom basePath", () => {
    const source = generateCliEntryPoint([greet], "/opt/tools");
    expect(source).toContain('BASE_PATH = "/opt/tools"');
  });

  test("includes busybox dispatch logic", () => {
    const source = generateCliEntryPoint([greet]);
    expect(source).toContain("process.argv[0]");
    expect(source).toContain("tsukumo");
  });

  test("includes --list flag handling", () => {
    const source = generateCliEntryPoint([greet, echo]);
    expect(source).toContain("--list");
  });

  test("includes response wait logic", () => {
    const source = generateCliEntryPoint([greet]);
    expect(source).toContain("waitForResponse");
    expect(source).toContain("fs.watch");
    expect(source).toContain("POLL_INTERVAL");
  });

  test("includes atomic write protocol", () => {
    const source = generateCliEntryPoint([greet]);
    expect(source).toContain(".json.tmp");
    expect(source).toContain("renameSync");
  });

  test("includes exit codes (0, 1, 2)", () => {
    const source = generateCliEntryPoint([greet]);
    expect(source).toContain("process.exit(0)");
    expect(source).toContain("process.exit(1)");
    expect(source).toContain("process.exit(2)");
  });

  test("imports only zod and zod-opts as external deps", () => {
    const source = generateCliEntryPoint([greet]);
    // External package imports
    expect(source).toContain('from "zod"');
    expect(source).toContain('from "zod-opts"');
    // Node built-in imports
    expect(source).toContain('from "node:fs"');
    expect(source).toContain('from "node:path"');
    expect(source).toContain('from "node:crypto"');
    // Should NOT import from tsukumo source
    expect(source).not.toContain("../");
    expect(source).not.toContain("./");
  });

  test("handles empty tools array", () => {
    const source = generateCliEntryPoint([]);
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const js = transpiler.transformSync(source);
    expect(js).toBeTruthy();
  });

  test("handles tools with boolean and enum args", () => {
    const tool = defineTool({
      name: "complex",
      description: "Complex tool",
      args: z.object({
        verbose: z.boolean().default(false),
        level: z.enum(["low", "medium", "high"]).default("medium"),
        tags: z.array(z.string()).optional(),
      }),
      handler: () => ({}),
    });

    const source = generateCliEntryPoint([tool]);
    expect(source).toContain("z.boolean().default(false)");
    expect(source).toContain('z.enum(["low","medium","high"]).default("medium")');
    expect(source).toContain("z.array(z.string()).optional()");
  });
});
