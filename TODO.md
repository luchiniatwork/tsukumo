# TODO

What remains to implement, in recommended order.

## Already Done

- [x] Project scaffolding (package.json, tsconfig, dependencies)
- [x] `src/` directory structure per §11
- [x] `defineTool()` — full implementation (`src/define.ts`)
- [x] Protocol types, error codes, exit codes (`src/protocol.ts`)
- [x] `SandboxBackend` interface (`src/backends/interface.ts`)
- [x] E2B adapter (`src/backends/e2b.ts`)
- [x] `ConcurrencyLimiter` (`src/host/concurrency.ts`)
- [x] `zodShapeToOpts()` bridge (`src/cli/bridge.ts`)
- [x] All public type exports (`src/index.ts`)
- [x] **Manifest generation** (`src/build/manifest.ts`)
  - Converts Zod schemas to JSON Schema via `zod-to-json-schema`
  - Outputs `{ version: 1, tools: [...] }` manifest structure
  - Uses structural `ManifestToolInput` type to avoid handler contravariance
- [x] **CLI entry point codegen** (`src/build/codegen.ts`)
  - `zodTypeToCode()` serializer: introspects Zod `_def` to emit TS source
    (string, number, boolean, enum, array + optional/default/describe +
    int/min/max/gt/lt/multipleOf refinements)
  - `generateCliEntryPoint()` produces a self-contained stub source that
    inlines busybox dispatch, zod-opts parsing, atomic request/response
    protocol, and fs.watch+poll wait logic
  - No imports from tsukumo source — only `zod` and `zod-opts`
- [x] **Bun compiler wrapper** (`src/build/compiler.ts`)
  - Shells out to `bun build --compile --target=<target>` via `Bun.spawn`
  - Writes binaries to `outDir` as `tsukumo-{target}`
  - Returns `CompileResult[]` with target and output path
- [x] Unit tests for manifest, codegen, and compiler (51 tests)

## Phase 2 — CLI Stub (§9)

The code that runs inside the sandbox binary.

- [ ] **Response wait strategy** (`src/cli/wait.ts`)
  - Primary: `fs.watch` on the responses directory
  - Fallback: poll every 50ms checking for `responses/{id}.json`
  - Timeout after 60s (configurable per-tool and via `--timeout` flag)
  - Return file contents as string on detection

- [ ] **CLI runner** (`src/cli/runner.ts`)
  - Detect tool name from `process.argv[0]` (symlink name) or subcommand
  - Parse and validate args against Zod schema via `zod-opts`
  - Generate UUIDv4 request ID
  - Atomic write: `requests/{id}.json.tmp` → rename to `requests/{id}.json`
  - Call `waitForResponse()` for the corresponding response file
  - On success: print result JSON to stdout, exit 0
  - On error: print message to stderr, exit 1
  - On timeout: print timeout to stderr, exit 2
  - `--list` flag: print all available tool names
  - `--help` flag: print usage (handled by zod-opts)

## Phase 3 — Host Runtime (§8)

Watches for requests from the sandbox and executes handlers.

- [ ] **Host runtime watcher** (`src/host/runtime.ts`)
  - Primary detection: `backend.watchDir()` on `requests/` for `.json` files
  - Secondary: reconciliation poll via `backend.list()` every 500ms
  - Deduplicate with in-memory set of processed request IDs
  - On new request:
    1. Read and parse request JSON
    2. Validate against protocol schema
    3. Look up tool handler by `request.tool`
    4. Execute handler with `request.args` (respect timeout + concurrency limit)
    5. Atomic write response: `responses/{id}.json.tmp` → rename to `.json`
    6. Clean up request file
  - Error handling per §8.3 (HANDLER_ERROR, HANDLER_TIMEOUT, UNKNOWN_TOOL, etc.)

## Phase 4 — Toolbox Orchestration (§4.3, §5.1, §6.1)

Ties everything together into the user-facing API.

- [ ] **`createToolbox()`** (`src/toolbox.ts`)
  - Validate tool names are unique
  - Store tools, basePath, maxConcurrency config

- [ ] **`toolbox.build()`** (`src/toolbox.ts`)
  - Call `generateCliEntryPoint()` with tool schemas
  - Call `compile()` for each target
  - Call `generateManifest()` and write to outDir

- [ ] **`toolbox.inject()`** (`src/toolbox.ts`)
  - Create directory structure: `bin/`, `requests/`, `responses/`
  - Upload stub binary to `{basePath}/bin/tsukumo`
  - `chmod +x` the binary
  - Create symlinks for each tool: `{name} → tsukumo`
  - Write `manifest.json` to `{basePath}/`
  - Optionally update PATH (append to `.bashrc`)
  - Start `startHostRuntime()` watcher
  - Return `InjectionHandle` with `dispose()` for cleanup

## Phase 5 — Tests

- [ ] Unit tests for `defineTool()` (validates schema, defaults timeout)
- [ ] Unit tests for `ConcurrencyLimiter` (respects limit, queues excess)
- [ ] Unit tests for `zodShapeToOpts()` bridge
- [x] Unit tests for manifest generation (Zod → JSON Schema correctness)
- [ ] Unit tests for protocol types (request/response serialization)
- [x] Unit tests for codegen (`zodTypeToCode` round-trip, generated source validity)
- [x] Unit tests for compiler wrapper (compilation, error handling)
- [ ] Integration test: codegen → compile → run stub binary
- [ ] Integration test: full round-trip (stub writes request → host reads → executes → writes response → stub reads)
- [ ] E2B adapter tests (mock or live sandbox)

## Open Questions (from §15)

These need resolution during implementation:

1. **PATH injection strategy** — `.bashrc` only covers interactive shells.
   Consider `/etc/environment`, wrapper scripts in `/usr/local/bin/`, or
   documenting that callers use full paths.

2. **Sandbox resume semantics** — `inject()` vs `attach()` split for
   reconnecting to an already-injected sandbox. Need to handle stale
   requests from before a pause.

3. **E2B persistence bug** (e2b-dev/E2B#884) — file changes may be lost
   after second pause/resume. May need to re-upload on every resume.
