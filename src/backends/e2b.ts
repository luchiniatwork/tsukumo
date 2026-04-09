/**
 * E2B sandbox backend adapter. See SPEC.md §6.3.
 *
 * Implements `SandboxBackend` by delegating to the E2B SDK's
 * `sandbox.files.*` and `sandbox.commands.run()` APIs.
 */

import type {
  Disposable,
  ExecResult,
  SandboxBackend,
  WatchEvent,
} from "./interface.ts";

/**
 * Minimal type for an E2B Sandbox instance.
 * We use a structural type so consumers don't need to import the E2B SDK
 * just to reference this adapter.
 */
export interface E2BSandbox {
  files: {
    write(path: string, content: string | Uint8Array): Promise<void>;
    read(path: string): Promise<string>;
    list(path: string): Promise<Array<{ name: string }>>;
    remove(path: string): Promise<void>;
    watchDir(
      path: string,
      callback: (event: WatchEvent) => void,
      opts?: { recursive?: boolean },
    ): Promise<{ stop(): Promise<void> }>;
  };
  commands: {
    run(
      command: string,
      opts?: { args?: string[] },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
}

/**
 * Create a `SandboxBackend` from an E2B Sandbox instance.
 */
export function createE2BBackend(sandbox: E2BSandbox): SandboxBackend {
  return {
    async writeFile(path, content) {
      await sandbox.files.write(path, content);
    },

    async readFile(path) {
      return sandbox.files.read(path);
    },

    async mkdir(path) {
      await sandbox.commands.run(`mkdir -p ${path}`);
    },

    async symlink(target, linkPath) {
      await sandbox.commands.run(`ln -s ${target} ${linkPath}`);
    },

    async chmod(path, mode) {
      await sandbox.commands.run(`chmod ${mode} ${path}`);
    },

    async exec(command, args) {
      const result = await sandbox.commands.run(command, {
        args: args ?? [],
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      } satisfies ExecResult;
    },

    async watchDir(path, callback, opts) {
      const handle = await sandbox.files.watchDir(path, callback, opts);
      return {
        async dispose() {
          await handle.stop();
        },
      } satisfies Disposable;
    },

    async remove(path) {
      await sandbox.files.remove(path);
    },

    async list(path) {
      const entries = await sandbox.files.list(path);
      return entries.map((e) => e.name);
    },
  };
}
