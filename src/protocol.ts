/**
 * Communication protocol types between the CLI stub (sandbox side) and
 * the host runtime. See SPEC.md §7 for details.
 */

/** Current protocol version. */
export const PROTOCOL_VERSION = 1;

/** Default base path inside the sandbox for tsukumo files. */
export const DEFAULT_BASE_PATH = "/tmp/tsukumo";

/**
 * Request written by the CLI stub to the sandbox filesystem.
 * Path: `{basePath}/requests/{id}.json`
 */
export interface ToolRequest {
  /** Protocol version. Always `1`. */
  v: typeof PROTOCOL_VERSION;
  /** UUIDv4 unique to this invocation. */
  id: string;
  /** Tool name matching the manifest. */
  tool: string;
  /** Validated arguments. */
  args: Record<string, unknown>;
  /** Unix timestamp (ms) of the request. */
  ts: number;
}

/**
 * Successful response written by the host runtime.
 * Path: `{basePath}/responses/{id}.json`
 */
export interface ToolResponseSuccess {
  v: typeof PROTOCOL_VERSION;
  id: string;
  ok: true;
  result: unknown;
  ts: number;
}

/**
 * Error response written by the host runtime.
 */
export interface ToolResponseError {
  v: typeof PROTOCOL_VERSION;
  id: string;
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
  };
  ts: number;
}

export type ToolResponse = ToolResponseSuccess | ToolResponseError;

/** Error codes as defined in SPEC.md §7.3. */
export type ErrorCode =
  | "HANDLER_ERROR"
  | "HANDLER_TIMEOUT"
  | "UNKNOWN_TOOL"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

/** Exit codes for the CLI stub (SPEC.md §9.4). */
export const ExitCode = {
  SUCCESS: 0,
  ERROR: 1,
  TIMEOUT: 2,
} as const;
