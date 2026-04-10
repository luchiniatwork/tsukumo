/**
 * Unit tests for the response wait strategy. See SPEC.md §9.3.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { waitForResponse } from "./wait.ts";

/** Create a temporary directory for test isolation. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsukumo-wait-test-"));
}

/** Clean up a temporary directory. */
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("waitForResponse", () => {
  test("resolves immediately when file already exists", async () => {
    const dir = makeTempDir();
    try {
      const responsePath = path.join(dir, "test.json");
      const expected = JSON.stringify({ ok: true, result: "hello" });
      fs.writeFileSync(responsePath, expected);

      const content = await waitForResponse({
        responsePath,
        timeout: 1_000,
      });
      expect(content).toBe(expected);
    } finally {
      removeTempDir(dir);
    }
  });

  test("resolves when file appears after a delay", async () => {
    const dir = makeTempDir();
    try {
      const responsePath = path.join(dir, "delayed.json");
      const expected = JSON.stringify({ ok: true, result: 42 });

      // Write the file after 100ms
      setTimeout(() => {
        fs.writeFileSync(responsePath, expected);
      }, 100);

      const content = await waitForResponse({
        responsePath,
        timeout: 2_000,
      });
      expect(content).toBe(expected);
    } finally {
      removeTempDir(dir);
    }
  });

  test("rejects with TIMEOUT when file never appears", async () => {
    const dir = makeTempDir();
    try {
      const responsePath = path.join(dir, "missing.json");

      await expect(
        waitForResponse({
          responsePath,
          timeout: 200,
        }),
      ).rejects.toThrow("TIMEOUT");
    } finally {
      removeTempDir(dir);
    }
  });

  test("respects custom timeout value", async () => {
    const dir = makeTempDir();
    try {
      const responsePath = path.join(dir, "timeout.json");
      const start = Date.now();

      await expect(
        waitForResponse({
          responsePath,
          timeout: 150,
        }),
      ).rejects.toThrow("TIMEOUT");

      const elapsed = Date.now() - start;
      // Should timeout around 150ms, allow some slack
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(500);
    } finally {
      removeTempDir(dir);
    }
  });

  test("respects custom poll interval", async () => {
    const dir = makeTempDir();
    try {
      const responsePath = path.join(dir, "poll.json");
      const expected = JSON.stringify({ ok: true });

      // Write the file after 50ms
      setTimeout(() => {
        fs.writeFileSync(responsePath, expected);
      }, 50);

      // Use a long poll interval — should still detect via fs.watch
      // or eventually via poll
      const content = await waitForResponse({
        responsePath,
        timeout: 2_000,
        pollInterval: 500,
      });
      expect(content).toBe(expected);
    } finally {
      removeTempDir(dir);
    }
  });

  test("handles atomic write pattern (tmp then rename)", async () => {
    const dir = makeTempDir();
    try {
      const responsePath = path.join(dir, "atomic.json");
      const tmpPath = responsePath + ".tmp";
      const expected = JSON.stringify({ ok: true, result: "atomic" });

      // Simulate the atomic write pattern: write .tmp first, then rename
      setTimeout(() => {
        fs.writeFileSync(tmpPath, expected);
        fs.renameSync(tmpPath, responsePath);
      }, 100);

      const content = await waitForResponse({
        responsePath,
        timeout: 2_000,
      });
      expect(content).toBe(expected);
    } finally {
      removeTempDir(dir);
    }
  });

  test("does not resolve on tmp file creation", async () => {
    const dir = makeTempDir();
    try {
      const responsePath = path.join(dir, "notmp.json");
      const tmpPath = responsePath + ".tmp";

      // Write only the .tmp file, never rename
      setTimeout(() => {
        fs.writeFileSync(tmpPath, "should not be read");
      }, 50);

      await expect(
        waitForResponse({
          responsePath,
          timeout: 300,
        }),
      ).rejects.toThrow("TIMEOUT");
    } finally {
      removeTempDir(dir);
    }
  });
});
