/**
 * Unit tests for the CLI stub runner. See SPEC.md §9.2.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import { PROTOCOL_VERSION, ExitCode } from "../protocol.ts";
import type { ToolResponse } from "../protocol.ts";
import {
  resolveInvocation,
  executeTool,
  parseToolArgs,
  formatList,
  formatHelp,
} from "./runner.ts";
import type { ToolEntry } from "./runner.ts";

// ─── Test Fixtures ──────────────────────────────────────────────────

/** Create a sample tools registry for tests. */
function makeTools(): Record<string, ToolEntry> {
  return {
    greet: {
      name: "greet",
      description: "Greets a person by name",
      schema: z.object({
        name: z.string().describe("Name of the person"),
        enthusiasm: z.number().int().min(1).max(10).default(5),
      }),
      timeout: 2_000,
    },
    echo: {
      name: "echo",
      description: "Echoes the input back",
      schema: z.object({
        message: z.string().describe("Message to echo"),
      }),
      timeout: 2_000,
    },
  };
}

/** Create a temporary directory with requests/ and responses/ subdirs. */
function makeTempBasePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsukumo-runner-test-"));
  fs.mkdirSync(path.join(dir, "requests"));
  fs.mkdirSync(path.join(dir, "responses"));
  return dir;
}

/** Clean up a temporary directory. */
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Watch the requests directory and write a response when a request appears.
 * Returns a cleanup function.
 */
function fakeHostRuntime(
  basePath: string,
  responseFactory: (
    request: { id: string; tool: string; args: Record<string, unknown> },
  ) => ToolResponse,
): { stop: () => void } {
  const requestsDir = path.join(basePath, "requests");
  const responsesDir = path.join(basePath, "responses");

  const timer = setInterval(() => {
    try {
      const files = fs.readdirSync(requestsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const requestPath = path.join(requestsDir, file);
        const content = fs.readFileSync(requestPath, "utf-8");
        const request = JSON.parse(content) as {
          id: string;
          tool: string;
          args: Record<string, unknown>;
        };

        const response = responseFactory(request);

        // Atomic write the response
        const responseTmpPath = path.join(
          responsesDir,
          `${request.id}.json.tmp`,
        );
        const responseFinalPath = path.join(
          responsesDir,
          `${request.id}.json`,
        );
        fs.writeFileSync(responseTmpPath, JSON.stringify(response));
        fs.renameSync(responseTmpPath, responseFinalPath);

        // Clean up request
        try {
          fs.unlinkSync(requestPath);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }, 20);

  return {
    stop: () => clearInterval(timer),
  };
}

// ─── resolveInvocation ──────────────────────────────────────────────

describe("resolveInvocation", () => {
  const tools = makeTools();

  test("detects symlink invocation (argv[0] matches tool name)", () => {
    const result = resolveInvocation(
      ["/tmp/tsukumo/bin/greet", "runner", "--name", "Ada"],
      tools,
    );
    expect(result).toEqual({
      type: "tool",
      toolName: "greet",
      cliArgs: ["--name", "Ada"],
    });
  });

  test("detects subcommand invocation", () => {
    const result = resolveInvocation(
      ["/tmp/tsukumo/bin/tsukumo", "runner", "echo", "--message", "hello"],
      tools,
    );
    expect(result).toEqual({
      type: "tool",
      toolName: "echo",
      cliArgs: ["--message", "hello"],
    });
  });

  test("returns list for --list flag", () => {
    const result = resolveInvocation(
      ["/tmp/tsukumo/bin/tsukumo", "runner", "--list"],
      tools,
    );
    expect(result).toEqual({ type: "list" });
  });

  test("returns help for --help flag", () => {
    const result = resolveInvocation(
      ["/tmp/tsukumo/bin/tsukumo", "runner", "--help"],
      tools,
    );
    expect(result).toEqual({ type: "help" });
  });

  test("returns help for -h flag", () => {
    const result = resolveInvocation(
      ["/tmp/tsukumo/bin/tsukumo", "runner", "-h"],
      tools,
    );
    expect(result).toEqual({ type: "help" });
  });

  test("returns help when no arguments", () => {
    const result = resolveInvocation(
      ["/tmp/tsukumo/bin/tsukumo", "runner"],
      tools,
    );
    expect(result).toEqual({ type: "help" });
  });

  test("returns error for unknown command", () => {
    const result = resolveInvocation(
      ["/tmp/tsukumo/bin/tsukumo", "runner", "nonexistent"],
      tools,
    );
    expect(result).toEqual({
      type: "error",
      message: "Unknown command: nonexistent",
    });
  });

  test("ignores unknown argv[0] (not a tool, not tsukumo)", () => {
    // When argv[0] is something other than "tsukumo" or a tool name,
    // it falls through to subcommand parsing
    const result = resolveInvocation(
      ["/usr/local/bin/node", "runner", "greet", "--name", "Ada"],
      tools,
    );
    expect(result).toEqual({
      type: "tool",
      toolName: "greet",
      cliArgs: ["--name", "Ada"],
    });
  });
});

// ─── formatList ─────────────────────────────────────────────────────

describe("formatList", () => {
  test("outputs all tool names, one per line", () => {
    const tools = makeTools();
    const output = formatList(tools);
    expect(output).toBe("greet\necho\n");
  });

  test("outputs empty string for empty tool registry", () => {
    const output = formatList({});
    expect(output).toBe("");
  });
});

// ─── formatHelp ─────────────────────────────────────────────────────

describe("formatHelp", () => {
  test("contains usage line", () => {
    const tools = makeTools();
    const output = formatHelp(tools);
    expect(output).toContain("Usage: tsukumo <command> [options]");
  });

  test("lists all tool names and descriptions", () => {
    const tools = makeTools();
    const output = formatHelp(tools);
    expect(output).toContain("greet");
    expect(output).toContain("Greets a person by name");
    expect(output).toContain("echo");
    expect(output).toContain("Echoes the input back");
  });

  test("contains --list and --help flags", () => {
    const tools = makeTools();
    const output = formatHelp(tools);
    expect(output).toContain("--list");
    expect(output).toContain("--help");
  });
});

// ─── parseToolArgs ──────────────────────────────────────────────────

describe("parseToolArgs", () => {
  test("parses required and optional args", () => {
    const tools = makeTools();
    const result = parseToolArgs(tools["greet"]!, [
      "--name",
      "Ada",
      "--enthusiasm",
      "7",
    ]);
    expect(result).toEqual({ name: "Ada", enthusiasm: 7 });
  });

  test("applies default values", () => {
    const tools = makeTools();
    const result = parseToolArgs(tools["greet"]!, ["--name", "Ada"]);
    expect(result).toEqual({ name: "Ada", enthusiasm: 5 });
  });
});

// ─── executeTool ────────────────────────────────────────────────────

describe("executeTool", () => {
  test("writes an atomic request file", async () => {
    const basePath = makeTempBasePath();
    const tools = makeTools();
    try {
      // Start a fake host that writes success responses
      const host = fakeHostRuntime(basePath, (req) => ({
        v: PROTOCOL_VERSION,
        id: req.id,
        ok: true,
        result: { greeting: `Hello, ${req.args["name"]}!` },
        ts: Date.now(),
      }));

      try {
        const result = await executeTool(
          "greet",
          { name: "Ada", enthusiasm: 5 },
          tools,
          basePath,
        );

        // Request file should have been cleaned up by the fake host
        const requestFiles = fs.readdirSync(
          path.join(basePath, "requests"),
        );
        expect(requestFiles).toHaveLength(0);

        expect(result.exitCode).toBe(ExitCode.SUCCESS);
      } finally {
        host.stop();
      }
    } finally {
      removeTempDir(basePath);
    }
  });

  test("returns success result on ok response", async () => {
    const basePath = makeTempBasePath();
    const tools = makeTools();
    try {
      const host = fakeHostRuntime(basePath, (req) => ({
        v: PROTOCOL_VERSION,
        id: req.id,
        ok: true,
        result: { echoed: req.args["message"] },
        ts: Date.now(),
      }));

      try {
        const result = await executeTool(
          "echo",
          { message: "hello" },
          tools,
          basePath,
        );

        expect(result.exitCode).toBe(ExitCode.SUCCESS);
        expect(result.stdout).toBe('{"echoed":"hello"}\n');
        expect(result.stderr).toBe("");
      } finally {
        host.stop();
      }
    } finally {
      removeTempDir(basePath);
    }
  });

  test("returns error result on error response", async () => {
    const basePath = makeTempBasePath();
    const tools = makeTools();
    try {
      const host = fakeHostRuntime(basePath, (req) => ({
        v: PROTOCOL_VERSION,
        id: req.id,
        ok: false,
        error: { code: "HANDLER_ERROR", message: "Something went wrong" },
        ts: Date.now(),
      }));

      try {
        const result = await executeTool(
          "greet",
          { name: "Ada" },
          tools,
          basePath,
        );

        expect(result.exitCode).toBe(ExitCode.ERROR);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("HANDLER_ERROR");
        expect(result.stderr).toContain("Something went wrong");
      } finally {
        host.stop();
      }
    } finally {
      removeTempDir(basePath);
    }
  });

  test("returns timeout result when no response", async () => {
    const basePath = makeTempBasePath();
    const tools: Record<string, ToolEntry> = {
      slow: {
        name: "slow",
        description: "A slow tool",
        schema: z.object({ input: z.string() }),
        timeout: 200, // Very short timeout for testing
      },
    };
    try {
      // No fake host — no one writes a response
      const result = await executeTool(
        "slow",
        { input: "test" },
        tools,
        basePath,
      );

      expect(result.exitCode).toBe(ExitCode.TIMEOUT);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Timeout");
      expect(result.stderr).toContain("200ms");
    } finally {
      removeTempDir(basePath);
    }
  });

  test("returns error for unknown tool name", async () => {
    const basePath = makeTempBasePath();
    const tools = makeTools();
    try {
      const result = await executeTool(
        "nonexistent",
        {},
        tools,
        basePath,
      );

      expect(result.exitCode).toBe(ExitCode.ERROR);
      expect(result.stderr).toContain("Unknown tool: nonexistent");
    } finally {
      removeTempDir(basePath);
    }
  });

  test("cleans up response file after reading", async () => {
    const basePath = makeTempBasePath();
    const tools = makeTools();
    try {
      const host = fakeHostRuntime(basePath, (req) => ({
        v: PROTOCOL_VERSION,
        id: req.id,
        ok: true,
        result: {},
        ts: Date.now(),
      }));

      try {
        await executeTool("echo", { message: "test" }, tools, basePath);

        // Response file should have been cleaned up
        const responseFiles = fs.readdirSync(
          path.join(basePath, "responses"),
        );
        expect(responseFiles).toHaveLength(0);
      } finally {
        host.stop();
      }
    } finally {
      removeTempDir(basePath);
    }
  });

  test("writes valid request JSON matching protocol", async () => {
    const basePath = makeTempBasePath();
    const tools = makeTools();
    let capturedRequest: Record<string, unknown> | null = null;

    try {
      const host = fakeHostRuntime(basePath, (req) => {
        capturedRequest = req as unknown as Record<string, unknown>;
        return {
          v: PROTOCOL_VERSION,
          id: req.id,
          ok: true,
          result: {},
          ts: Date.now(),
        };
      });

      try {
        await executeTool(
          "greet",
          { name: "Ada", enthusiasm: 7 },
          tools,
          basePath,
        );

        expect(capturedRequest).not.toBeNull();
        expect(capturedRequest!["tool"]).toBe("greet");
        expect(capturedRequest!["args"]).toEqual({
          name: "Ada",
          enthusiasm: 7,
        });
      } finally {
        host.stop();
      }
    } finally {
      removeTempDir(basePath);
    }
  });
});
