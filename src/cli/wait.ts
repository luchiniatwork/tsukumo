/**
 * Response wait strategy for the CLI stub. See SPEC.md §9.3.
 *
 * Uses `fs.watch` with a polling fallback to detect when the host
 * runtime writes the response file.
 */

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
 * Returns the file contents as a string.
 */
export async function waitForResponse(
  _options: WaitOptions,
): Promise<string> {
  // TODO: implement fs.watch + poll fallback
  throw new Error("Not implemented");
}
