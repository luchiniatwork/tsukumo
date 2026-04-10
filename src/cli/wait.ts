/**
 * Response wait strategy for the CLI stub. See SPEC.md §9.3.
 *
 * Uses `fs.watch` with a polling fallback to detect when the host
 * runtime writes the response file. The dual strategy ensures reliable
 * detection: `fs.watch` provides low-latency notification while polling
 * catches any missed events (e.g., inotify queue overflow).
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Options for the response wait. */
export interface WaitOptions {
  /** Path to the response file to wait for. */
  responsePath: string;

  /** Timeout in milliseconds. Defaults to 60_000 (60 seconds). */
  timeout?: number;

  /** Poll interval in milliseconds. Defaults to 50. */
  pollInterval?: number;
}

/** Default stub-side timeout in milliseconds. */
export const DEFAULT_STUB_TIMEOUT = 60_000;

/** Default poll interval in milliseconds. */
export const DEFAULT_POLL_INTERVAL = 50;

/**
 * Wait for a response file to appear at the given path.
 * Uses fs.watch with a poll fallback as described in SPEC.md §9.3.
 *
 * Returns the file contents as a string. Rejects with an error whose
 * message is `"TIMEOUT"` if the file does not appear within the
 * configured timeout.
 */
export async function waitForResponse(options: WaitOptions): Promise<string> {
  const timeout = options.timeout ?? DEFAULT_STUB_TIMEOUT;
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let watcher: fs.FSWatcher | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function cleanup(): void {
      if (watcher) {
        try {
          watcher.close();
        } catch {
          /* ignore */
        }
      }
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    function tryRead(): string | null {
      try {
        return fs.readFileSync(options.responsePath, "utf-8");
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
      const dirPath = path.dirname(options.responsePath);
      const fileName = path.basename(options.responsePath);
      watcher = fs.watch(dirPath, (_event, fn) => {
        if (fn === fileName) onDetected();
      });
      watcher.on("error", () => {
        // Watch failed — rely on polling
        if (watcher) {
          try {
            watcher.close();
          } catch {
            /* ignore */
          }
          watcher = null;
        }
      });
    } catch {
      // fs.watch not supported — polling only
    }

    // Secondary: poll as fallback
    pollTimer = setInterval(onDetected, pollInterval);

    // Check immediately in case the response already exists
    onDetected();
  });
}
