/**
 * Tests for manifest generation (src/build/manifest.ts).
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { defineTool } from "../define.ts";
import { generateManifest } from "./manifest.ts";

describe("generateManifest", () => {
  test("returns version 1 with empty tools array", () => {
    const manifest = generateManifest([]);
    expect(manifest.version).toBe(1);
    expect(manifest.tools).toEqual([]);
  });

  test("converts a single tool with simple args", () => {
    const tool = defineTool({
      name: "greet",
      description: "Greets a person",
      args: z.object({
        name: z.string().describe("Person's name"),
      }),
      handler: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
    });

    const manifest = generateManifest([tool]);

    expect(manifest.version).toBe(1);
    expect(manifest.tools).toHaveLength(1);

    const entry = manifest.tools[0]!;
    expect(entry.name).toBe("greet");
    expect(entry.description).toBe("Greets a person");
    expect(entry.timeout).toBe(30_000);

    // JSON Schema should describe an object with a required "name" string
    expect(entry.args).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string", description: "Person's name" },
      },
      required: ["name"],
    });
  });

  test("does not include $schema in args", () => {
    const tool = defineTool({
      name: "echo",
      description: "Echoes input",
      args: z.object({ msg: z.string() }),
      handler: ({ msg }) => ({ msg }),
    });

    const manifest = generateManifest([tool]);
    expect(manifest.tools[0]!.args).not.toHaveProperty("$schema");
  });

  test("preserves custom timeout", () => {
    const tool = defineTool({
      name: "slow",
      description: "Slow tool",
      args: z.object({}),
      handler: async () => ({}),
      timeout: 120_000,
    });

    const manifest = generateManifest([tool]);
    expect(manifest.tools[0]!.timeout).toBe(120_000);
  });

  test("handles multiple tools", () => {
    const tools = [
      defineTool({
        name: "alpha",
        description: "First tool",
        args: z.object({ a: z.string() }),
        handler: () => ({}),
      }),
      defineTool({
        name: "beta",
        description: "Second tool",
        args: z.object({ b: z.number() }),
        handler: () => ({}),
      }),
    ];

    const manifest = generateManifest(tools);
    expect(manifest.tools).toHaveLength(2);
    expect(manifest.tools[0]!.name).toBe("alpha");
    expect(manifest.tools[1]!.name).toBe("beta");
  });

  test("converts optional and default fields correctly", () => {
    const tool = defineTool({
      name: "opts",
      description: "Optional fields",
      args: z.object({
        required: z.string(),
        optional: z.string().optional(),
        withDefault: z.number().default(42),
      }),
      handler: () => ({}),
    });

    const manifest = generateManifest([tool]);
    const args = manifest.tools[0]!.args as Record<string, unknown>;

    // Only "required" should be in the required array — optional and
    // defaulted fields are not required at the CLI level.
    const required = args["required"] as string[];
    expect(required).toContain("required");
    expect(required).not.toContain("optional");
    expect(required).not.toContain("withDefault");

    // Default value should be present in the schema
    const props = args["properties"] as Record<string, Record<string, unknown>>;
    expect(props["withDefault"]!["default"]).toBe(42);
  });

  test("converts boolean fields", () => {
    const tool = defineTool({
      name: "flags",
      description: "Boolean flags",
      args: z.object({
        verbose: z.boolean().default(false).describe("Enable verbose output"),
      }),
      handler: () => ({}),
    });

    const manifest = generateManifest([tool]);
    const props = (manifest.tools[0]!.args as Record<string, unknown>)[
      "properties"
    ] as Record<string, Record<string, unknown>>;

    expect(props["verbose"]).toMatchObject({
      type: "boolean",
      default: false,
      description: "Enable verbose output",
    });
  });

  test("converts enum fields", () => {
    const tool = defineTool({
      name: "level",
      description: "Has an enum",
      args: z.object({
        level: z.enum(["low", "medium", "high"]),
      }),
      handler: () => ({}),
    });

    const manifest = generateManifest([tool]);
    const props = (manifest.tools[0]!.args as Record<string, unknown>)[
      "properties"
    ] as Record<string, Record<string, unknown>>;

    expect(props["level"]!["enum"]).toEqual(["low", "medium", "high"]);
  });

  test("converts array fields", () => {
    const tool = defineTool({
      name: "tags",
      description: "Has an array",
      args: z.object({
        tags: z.array(z.string()).describe("List of tags"),
      }),
      handler: () => ({}),
    });

    const manifest = generateManifest([tool]);
    const props = (manifest.tools[0]!.args as Record<string, unknown>)[
      "properties"
    ] as Record<string, Record<string, unknown>>;

    expect(props["tags"]).toMatchObject({
      type: "array",
      items: { type: "string" },
      description: "List of tags",
    });
  });

  test("converts number refinements (min, max)", () => {
    const tool = defineTool({
      name: "bounded",
      description: "Bounded number",
      args: z.object({
        score: z.number().int().min(1).max(10),
      }),
      handler: () => ({}),
    });

    const manifest = generateManifest([tool]);
    const props = (manifest.tools[0]!.args as Record<string, unknown>)[
      "properties"
    ] as Record<string, Record<string, unknown>>;

    expect(props["score"]).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 10,
    });
  });

  test("manifest is JSON-serializable", () => {
    const tool = defineTool({
      name: "roundtrip",
      description: "Serialization test",
      args: z.object({
        name: z.string(),
        count: z.number().optional(),
      }),
      handler: () => ({}),
    });

    const manifest = generateManifest([tool]);
    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(1);
    expect(parsed.tools[0].name).toBe("roundtrip");
  });
});
