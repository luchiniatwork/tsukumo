/**
 * Sandbox backend abstraction. See SPEC.md §6.3.
 *
 * Any environment that provides a shared filesystem with a watch
 * mechanism can implement this interface.
 */

export interface WatchEvent {
  type: string;
  name: string;
  path: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Disposable {
  dispose(): Promise<void>;
}

/**
 * Abstract interface for sandbox filesystem and command operations.
 * E2B is the primary implementation, but Docker, local filesystem,
 * etc. can also implement this.
 */
export interface SandboxBackend {
  /** Write a file to the sandbox filesystem. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;

  /** Read a file from the sandbox filesystem. */
  readFile(path: string): Promise<string>;

  /** Create a directory (recursive). */
  mkdir(path: string): Promise<void>;

  /** Create a symlink inside the sandbox. */
  symlink(target: string, linkPath: string): Promise<void>;

  /** Set file permissions. */
  chmod(path: string, mode: string): Promise<void>;

  /** Execute a command in the sandbox. */
  exec(command: string, args?: string[]): Promise<ExecResult>;

  /**
   * Watch a directory for file creation events.
   * Calls the callback when a new file appears.
   * Returns a disposable handle.
   */
  watchDir(
    path: string,
    callback: (event: WatchEvent) => void,
    opts?: { recursive?: boolean },
  ): Promise<Disposable>;

  /** Remove a file or directory. */
  remove(path: string): Promise<void>;

  /** List files in a directory. */
  list(path: string): Promise<string[]>;
}
