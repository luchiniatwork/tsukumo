/**
 * CLI stub runner — the modular, testable implementation of the CLI
 * logic that runs inside the compiled sandbox binary. See SPEC.md §9.2.
 *
 * This module mirrors the logic that `codegen.ts` inlines into the
 * generated entry point. It exists as a separate module so the CLI
 * behavior can be unit-tested without a full codegen → compile cycle.
 *
 * NOTE: This module is only used inside the compiled stub binary.
 * It should NOT be imported by host-side code.
 */

import type { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parser } from "zod-opts";
import { PROTOCOL_VERSION, DEFAULT_BASE_PATH, ExitCode } from "../protocol.ts";
import type { ToolRequest, ToolResponse } from "../protocol.ts";
import { waitForResponse } from "./wait.ts";
import { zodShapeToOpts } from "./bridge.ts";

// ─── Types ──────────────────────────────────────────────────────────

/** A tool entry in the CLI stub's tool registry. */
export interface ToolEntry {
  /** Unique tool name. */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
  /** Zod schema for the tool's arguments. */
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /** Handler timeout in milliseconds. */
  readonly timeout: number;
}

/** Result of a tool execution, returned by `executeTool`. */
export interface ExecutionResult {
  /** Exit code: 0 = success, 1 = error, 2 = timeout. */
  exitCode: number;
  /** Content for stdout (success result JSON). */
  stdout: string;
  /** Content for stderr (error messages). */
  stderr: string;
}

/**
 * Discriminated union describing the resolved invocation type.
 * Returned by `resolveInvocation` to separate parsing from execution.
 */
export type Invocation =
  | { type: "tool"; toolName: string; cliArgs: string[] }
  | { type: "list" }
  | { type: "help"; subcommand?: string }
  | { type: "error"; message: string };

// ─── Invocation Resolution ──────────────────────────────────────────

/**
 * Determine what action to take based on `argv`.
 *
 * Implements the busybox pattern (§3.1): if `argv[0]` basename matches
 * a tool name (symlink invocation), dispatch directly. Otherwise treat
 * the first positional argument as a subcommand.
 */
export function resolveInvocation(
  argv: readonly string[],
  tools: Record<string, ToolEntry>,
): Invocation {
  const invocationName = path.basename(argv[0] ?? "");
  const args = argv.slice(2);

  // ── Direct tool invocation via symlink ──
  if (invocationName !== "tsukumo" && invocationName in tools) {
    return { type: "tool", toolName: invocationName, cliArgs: args };
  }

  // ── Invoked as "tsukumo" ──

  // Handle --list flag
  if (args.includes("--list")) {
    return { type: "list" };
  }

  // Handle --help, -h, or no arguments
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return { type: "help" };
  }

  // Subcommand dispatch
  if (!(subcommand in tools)) {
    return {
      type: "error",
      message: `Unknown command: ${subcommand}`,
    };
  }

  return { type: "tool", toolName: subcommand, cliArgs: args.slice(1) };
}

// ─── Formatting ─────────────────────────────────────────────────────

/**
 * Format the `--list` output: one tool name per line.
 */
export function formatList(tools: Record<string, ToolEntry>): string {
  return Object.keys(tools)
    .map((name) => name + "\n")
    .join("");
}

/**
 * Format the `--help` output: usage line followed by a commands table.
 */
export function formatHelp(tools: Record<string, ToolEntry>): string {
  const lines: string[] = [];
  lines.push("Usage: tsukumo <command> [options]\n");
  lines.push("\n");
  lines.push("Commands:\n");
  for (const name of Object.keys(tools)) {
    const desc = tools[name]!.description;
    lines.push(`  ${name.padEnd(20)} ${desc}\n`);
  }
  lines.push("\n");
  lines.push("Flags:\n");
  lines.push("  --list               List all available tools\n");
  lines.push("  --help               Show this help message\n");
  return lines.join("");
}

// ─── Tool Execution ─────────────────────────────────────────────────

/**
 * Execute a tool invocation: write the request file (atomic), wait
 * for the response, parse it, and return a structured result.
 *
 * Does NOT call `process.exit()` — the caller is responsible for
 * handling the exit code. This makes the function testable.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  tools: Record<string, ToolEntry>,
  basePath: string,
): Promise<ExecutionResult> {
  const tool = tools[toolName];
  if (!tool) {
    return {
      exitCode: ExitCode.ERROR,
      stdout: "",
      stderr: `Unknown tool: ${toolName}\n`,
    };
  }

  const id = crypto.randomUUID();
  const request: ToolRequest = {
    v: PROTOCOL_VERSION,
    id,
    tool: toolName,
    args,
    ts: Date.now(),
  };

  const requestsDir = path.join(basePath, "requests");
  const responsesDir = path.join(basePath, "responses");
  const requestTmpPath = path.join(requestsDir, `${id}.json.tmp`);
  const requestPath = path.join(requestsDir, `${id}.json`);
  const responsePath = path.join(responsesDir, `${id}.json`);

  // Atomic write: .tmp → rename (§7.4)
  fs.writeFileSync(requestTmpPath, JSON.stringify(request));
  fs.renameSync(requestTmpPath, requestPath);

  try {
    const content = await waitForResponse({
      responsePath,
      timeout: tool.timeout,
    });

    // Clean up response file
    try {
      fs.unlinkSync(responsePath);
    } catch {
      /* ignore */
    }

    const response = JSON.parse(content) as ToolResponse;

    if (response.ok) {
      return {
        exitCode: ExitCode.SUCCESS,
        stdout: JSON.stringify(response.result) + "\n",
        stderr: "",
      };
    } else {
      return {
        exitCode: ExitCode.ERROR,
        stdout: "",
        stderr: `Error [${response.error.code}]: ${response.error.message}\n`,
      };
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMEOUT") {
      return {
        exitCode: ExitCode.TIMEOUT,
        stdout: "",
        stderr: `Timeout: no response within ${tool.timeout}ms\n`,
      };
    }
    throw err;
  }
}

// ─── CLI Argument Parsing ───────────────────────────────────────────

/**
 * Parse CLI arguments for a specific tool using zod-opts.
 *
 * Returns the validated, typed arguments as a plain object.
 */
export function parseToolArgs(
  tool: ToolEntry,
  cliArgs: readonly string[],
  prefix?: string,
): Record<string, unknown> {
  const name = prefix ? `${prefix} ${tool.name}` : tool.name;
  return parser()
    .name(name)
    .description(tool.description)
    .options(zodShapeToOpts(tool.schema.shape))
    .parse([...cliArgs]) as Record<string, unknown>;
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Main CLI entry point. Resolves the invocation, parses arguments,
 * executes the tool, and calls `process.exit()` with the appropriate
 * exit code.
 *
 * This is the only function that calls `process.exit()`.
 */
export async function runCli(
  tools: Record<string, ToolEntry>,
  basePath: string = DEFAULT_BASE_PATH,
): Promise<never> {
  const invocation = resolveInvocation(process.argv, tools);

  switch (invocation.type) {
    case "list": {
      process.stdout.write(formatList(tools));
      return process.exit(ExitCode.SUCCESS) as never;
    }

    case "help": {
      process.stderr.write(formatHelp(tools));
      return process.exit(ExitCode.ERROR) as never;
    }

    case "error": {
      process.stderr.write(invocation.message + "\n");
      process.stderr.write(
        "Run 'tsukumo --list' to see available commands.\n",
      );
      return process.exit(ExitCode.ERROR) as never;
    }

    case "tool": {
      const tool = tools[invocation.toolName]!;
      const prefix =
        path.basename(process.argv[0] ?? "") === "tsukumo"
          ? "tsukumo"
          : undefined;
      const parsed = parseToolArgs(tool, invocation.cliArgs, prefix);
      const result = await executeTool(
        invocation.toolName,
        parsed,
        tools,
        basePath,
      );

      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return process.exit(result.exitCode) as never;
    }
  }
}
