/**
 * CLI entry point code generation. See SPEC.md §5.2.
 *
 * Generates a self-contained TypeScript source string that, when compiled
 * by `bun build --compile`, becomes the CLI stub binary injected into
 * sandboxes. The generated code embeds tool schemas (not handlers) and
 * wires up the busybox pattern, argument parsing via zod-opts, and the
 * request/response file protocol.
 */

import type { z } from "zod";

/**
 * Minimal tool shape for code generation.
 *
 * Uses `z.ZodTypeAny` for `args` to avoid handler contravariance issues
 * when accepting heterogeneous tool arrays. Internally casts to
 * `z.ZodObject` to access `.shape`.
 */
interface CodegenToolInput {
  readonly name: string;
  readonly description: string;
  readonly args: z.ZodTypeAny;
  readonly timeout: number;
}

/**
 * Serialize a Zod type to TypeScript source code that recreates
 * an equivalent schema.
 *
 * Supported types:
 * - Core: `z.string()`, `z.number()`, `z.boolean()`, `z.enum([...])`,
 *   `z.array(...)`
 * - Modifiers: `.optional()`, `.default(val)`, `.describe("text")`
 * - Refinements: `.int()`, `.min()`, `.max()`, `.gt()`, `.lt()` on
 *   numbers; `.min()`, `.max()` on strings and arrays
 *
 * Throws for unsupported types with a descriptive error message.
 */
export function zodTypeToCode(zodType: z.ZodTypeAny): string {
  // NOTE: Zod schemas expose their definition via `_def`. This is a
  // widely-used introspection pattern (zod-to-json-schema, etc.).
  const def = zodType._def as Record<string, unknown>;
  const typeName = def["typeName"] as string | undefined;

  let code: string;

  switch (typeName) {
    case "ZodString": {
      code = "z.string()";
      const checks = (def["checks"] ?? []) as Array<{
        kind: string;
        value?: number;
      }>;
      for (const check of checks) {
        if (check.kind === "min" && check.value !== undefined) {
          code += `.min(${check.value})`;
        } else if (check.kind === "max" && check.value !== undefined) {
          code += `.max(${check.value})`;
        }
        // Other string checks (email, url, regex, etc.) are not
        // meaningful for CLI argument parsing — silently skip.
      }
      break;
    }

    case "ZodNumber": {
      code = "z.number()";
      const checks = (def["checks"] ?? []) as Array<{
        kind: string;
        value?: number;
        inclusive?: boolean;
      }>;
      for (const check of checks) {
        if (check.kind === "int") {
          code += ".int()";
        } else if (check.kind === "min" && check.value !== undefined) {
          code += check.inclusive !== false
            ? `.min(${check.value})`
            : `.gt(${check.value})`;
        } else if (check.kind === "max" && check.value !== undefined) {
          code += check.inclusive !== false
            ? `.max(${check.value})`
            : `.lt(${check.value})`;
        } else if (
          check.kind === "multipleOf" &&
          check.value !== undefined
        ) {
          code += `.multipleOf(${check.value})`;
        }
      }
      break;
    }

    case "ZodBoolean": {
      code = "z.boolean()";
      break;
    }

    case "ZodEnum": {
      const values = def["values"] as string[];
      code = `z.enum(${JSON.stringify(values)})`;
      break;
    }

    case "ZodArray": {
      const elementType = def["type"] as z.ZodTypeAny;
      code = `z.array(${zodTypeToCode(elementType)})`;
      const minLength = def["minLength"] as
        | { value: number }
        | null
        | undefined;
      const maxLength = def["maxLength"] as
        | { value: number }
        | null
        | undefined;
      if (minLength != null) {
        code += `.min(${minLength.value})`;
      }
      if (maxLength != null) {
        code += `.max(${maxLength.value})`;
      }
      break;
    }

    case "ZodOptional": {
      const innerType = def["innerType"] as z.ZodTypeAny;
      code = `${zodTypeToCode(innerType)}.optional()`;
      break;
    }

    case "ZodDefault": {
      const innerType = def["innerType"] as z.ZodTypeAny;
      const defaultValueFn = def["defaultValue"] as () => unknown;
      const defaultValue = defaultValueFn();
      code = `${zodTypeToCode(innerType)}.default(${JSON.stringify(defaultValue)})`;
      break;
    }

    default:
      throw new Error(
        `Unsupported Zod type in code generation: ${typeName ?? "unknown"}. ` +
          "Supported types: string, number, boolean, enum, array " +
          "(with optional, default, and describe modifiers).",
      );
  }

  // Append .describe() if this type has a description that isn't
  // already present on the inner type. Zod propagates descriptions
  // to wrapper types (ZodOptional, ZodDefault), so we must deduplicate
  // to avoid generating redundant `.describe()` calls.
  const description = def["description"] as string | undefined;
  if (description !== undefined) {
    const isWrapper = typeName === "ZodOptional" || typeName === "ZodDefault";
    const innerDesc = isWrapper
      ? ((def["innerType"] as z.ZodTypeAny)?._def as Record<string, unknown>)?.[
          "description"
        ]
      : undefined;

    if (description !== innerDesc) {
      code += `.describe(${JSON.stringify(description)})`;
    }
  }

  return code;
}

/**
 * Generate the inline Zod object schema code for a single tool.
 *
 * Produces a string like:
 * ```
 * z.object({
 *   name: z.string().describe("Person's name"),
 *   enthusiasm: z.number().int().min(1).max(10).default(5),
 * })
 * ```
 */
function generateSchemaCode(args: z.ZodTypeAny): string {
  const schema = args as z.ZodObject<z.ZodRawShape>;
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const entries = Object.entries(shape);

  if (entries.length === 0) {
    return "z.object({})";
  }

  const fields = entries
    .map(([key, type]) => `    ${key}: ${zodTypeToCode(type)},`)
    .join("\n");

  return `z.object({\n${fields}\n  })`;
}

/**
 * Generate the tools record source code.
 *
 * Produces a const declaration mapping tool names to their metadata
 * and inline Zod schemas.
 */
function generateToolsRecord(tools: readonly CodegenToolInput[]): string {
  const entries = tools.map((tool) => {
    const schemaCode = generateSchemaCode(tool.args);
    return [
      `  ${JSON.stringify(tool.name)}: {`,
      `    name: ${JSON.stringify(tool.name)},`,
      `    description: ${JSON.stringify(tool.description)},`,
      `    schema: ${schemaCode},`,
      `    timeout: ${tool.timeout},`,
      `  },`,
    ].join("\n");
  });

  return `const tools: Record<string, ToolEntry> = {\n${entries.join("\n")}\n};`;
}

/**
 * Generate the CLI entry point source code for the compiled stub binary.
 *
 * The generated code is fully self-contained — it imports only from
 * `zod` and `zod-opts` (resolved by Bun at compile time) and inlines
 * all protocol, bridge, and wait logic. This avoids import path
 * resolution issues and ensures the generated file works from any
 * location.
 *
 * The generated source implements:
 * - Busybox pattern: `argv[0]` detection for symlink invocation, plus
 *   subcommand dispatch when invoked as `tsukumo`
 * - `zod-opts` for CLI argument parsing per tool
 * - Atomic request write (`.tmp` → rename per §7.4)
 * - Response wait with `fs.watch` + poll fallback (§9.3)
 * - Exit codes: 0 (success), 1 (error), 2 (timeout) per §9.4
 * - `--list` flag to enumerate available tools
 */
export function generateCliEntryPoint(
  tools: readonly CodegenToolInput[],
  basePath: string = "/tmp/tsukumo",
): string {
  const toolsRecord = generateToolsRecord(tools);

  return `// Generated by tsukumo — do not edit.
// This file is compiled into the CLI stub binary that runs inside sandboxes.
// See SPEC.md §5.2 and §9 for details.

import { z } from "zod";
import { parser } from "zod-opts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────

interface ToolEntry {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  timeout: number;
}

// ─── Protocol Constants ─────────────────────────────────────────────

const PROTOCOL_VERSION = 1;
const BASE_PATH = ${JSON.stringify(basePath)};

// ─── Tool Definitions ───────────────────────────────────────────────

${toolsRecord}

// ─── Bridge: Zod shape → zod-opts options (SPEC.md §9.1) ───────────

function zodShapeToOpts(
  shape: Record<string, z.ZodTypeAny>,
): Record<string, { type: z.ZodTypeAny }> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, zodType]) => [key, { type: zodType }]),
  );
}

// ─── Response Wait (SPEC.md §9.3) ──────────────────────────────────

const POLL_INTERVAL = 50;

async function waitForResponse(
  responsePath: string,
  timeout: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let watcher: fs.FSWatcher | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function cleanup(): void {
      if (watcher) {
        try { watcher.close(); } catch { /* ignore */ }
      }
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    function tryRead(): string | null {
      try {
        return fs.readFileSync(responsePath, "utf-8");
      } catch {
        return null;
      }
    }

    function onDetected(): void {
      if (settled) return;
      const content = tryRead();
      if (content !== null) {
        settled = true;
        cleanup();
        resolve(content);
      }
    }

    // Timeout handler
    timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("TIMEOUT"));
      }
    }, timeout);

    // Primary: fs.watch on the responses directory
    try {
      const dirPath = path.dirname(responsePath);
      const fileName = path.basename(responsePath);
      watcher = fs.watch(dirPath, (_event, fn) => {
        if (fn === fileName) onDetected();
      });
      watcher.on("error", () => {
        // Watch failed — rely on polling
        if (watcher) {
          try { watcher.close(); } catch { /* ignore */ }
          watcher = null;
        }
      });
    } catch {
      // fs.watch not supported — polling only
    }

    // Secondary: poll as fallback
    pollTimer = setInterval(onDetected, POLL_INTERVAL);

    // Check immediately in case the response already exists
    onDetected();
  });
}

// ─── Tool Execution ─────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const tool = tools[toolName];
  if (!tool) {
    process.stderr.write(\`Unknown tool: \${toolName}\\n\`);
    process.exit(1);
  }

  const id = crypto.randomUUID();
  const request = {
    v: PROTOCOL_VERSION,
    id,
    tool: toolName,
    args,
    ts: Date.now(),
  };

  const requestsDir = path.join(BASE_PATH, "requests");
  const responsesDir = path.join(BASE_PATH, "responses");
  const requestTmpPath = path.join(requestsDir, \`\${id}.json.tmp\`);
  const requestPath = path.join(requestsDir, \`\${id}.json\`);
  const responsePath = path.join(responsesDir, \`\${id}.json\`);

  // Atomic write: .tmp → rename (§7.4)
  fs.writeFileSync(requestTmpPath, JSON.stringify(request));
  fs.renameSync(requestTmpPath, requestPath);

  try {
    const content = await waitForResponse(responsePath, tool.timeout);

    // Clean up response file
    try { fs.unlinkSync(responsePath); } catch { /* ignore */ }

    const response = JSON.parse(content);

    if (response.ok) {
      process.stdout.write(JSON.stringify(response.result) + "\\n");
      process.exit(0);
    } else {
      process.stderr.write(
        \`Error [\${response.error.code}]: \${response.error.message}\\n\`,
      );
      process.exit(1);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMEOUT") {
      process.stderr.write(
        \`Timeout: no response within \${tool.timeout}ms\\n\`,
      );
      process.exit(2);
    }
    throw err;
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────

async function main(): Promise<void> {
  const invocationName = path.basename(process.argv[0] ?? "");
  const args = process.argv.slice(2);

  // ── Direct tool invocation via symlink ──
  if (invocationName !== "tsukumo" && invocationName in tools) {
    const tool = tools[invocationName]!;
    const parsed = parser()
      .name(tool.name)
      .description(tool.description)
      .options(zodShapeToOpts(tool.schema.shape))
      .parse(args) as Record<string, unknown>;
    await executeTool(tool.name, parsed);
    return;
  }

  // ── Invoked as "tsukumo" ──

  // Handle --list flag
  if (args.includes("--list")) {
    for (const name of Object.keys(tools)) {
      process.stdout.write(name + "\\n");
    }
    process.exit(0);
  }

  // Handle --help or no arguments
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    const toolNames = Object.keys(tools);
    process.stderr.write("Usage: tsukumo <command> [options]\\n\\n");
    process.stderr.write("Commands:\\n");
    for (const name of toolNames) {
      const desc = tools[name]!.description;
      process.stderr.write(\`  \${name.padEnd(20)} \${desc}\\n\`);
    }
    process.stderr.write("\\nFlags:\\n");
    process.stderr.write("  --list               List all available tools\\n");
    process.stderr.write("  --help               Show this help message\\n");
    process.exit(subcommand ? 0 : 1);
  }

  // Subcommand dispatch
  if (!(subcommand in tools)) {
    process.stderr.write(\`Unknown command: \${subcommand}\\n\`);
    process.stderr.write("Run 'tsukumo --list' to see available commands.\\n");
    process.exit(1);
  }

  const tool = tools[subcommand]!;
  const subArgs = args.slice(1);
  const parsed = parser()
    .name(\`tsukumo \${subcommand}\`)
    .description(tool.description)
    .options(zodShapeToOpts(tool.schema.shape))
    .parse(subArgs) as Record<string, unknown>;
  await executeTool(subcommand, parsed);
}

main().catch((err: unknown) => {
  process.stderr.write(
    \`Error: \${err instanceof Error ? err.message : String(err)}\\n\`,
  );
  process.exit(1);
});
`;
}
