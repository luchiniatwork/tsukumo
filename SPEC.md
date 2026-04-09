# Tsukumo Specification

> **tsukumo** (付喪) — from *tsukumogami*, spirits that inhabit tools
> after long use. A library for giving tools to sandboxes.

**Status:** Draft v0.2
**Date:** 2026-04-09

---

## 1. Overview

Tsukumo is a TypeScript library that lets you **define tools** with typed
arguments and **inject them into sandboxes** as callable CLI commands. The
tool's logic executes on the **host side**; only a thin CLI stub runs inside
the sandbox. Communication between the stub and the host flows through the
sandbox filesystem using a request/response file protocol.

The primary target environment is **E2B Firecracker microVMs**, but the
architecture is deliberately sandbox-agnostic — any environment that provides
a shared filesystem with a watch mechanism can serve as a backend.

### 1.1 Design Goals

- **Minimal sandbox footprint.** Only a single compiled binary lives inside
  the sandbox. No runtime, no `node_modules`, no interpreter.
- **Type-safe tool definitions.** Zod schemas define the tool's interface.
  The same schema drives CLI argument parsing (sandbox side) and handler
  type inference (host side).
- **Host-side execution.** Tool handler code runs on the host with full
  access to the network, databases, APIs — things sandboxes intentionally
  restrict.
- **Multi-tool injection.** Many tools can be injected into one sandbox.
  They share a single binary and a single communication channel.
- **Cross-platform CLI.** The compiled stub binary can target any platform
  Bun supports: linux-x64, linux-arm64, darwin-x64, darwin-arm64,
  windows-x64, etc.

### 1.2 Non-Goals (v1)

- Streaming responses (chunked/SSE-style output from tools).
- Binary payload transfer (images, files). V1 is JSON-in, JSON-out.
- Bidirectional communication (host calling into sandbox).
- Tool discovery/registration at runtime (tools are statically defined at
  build time).

---

## 2. Concepts

| Term             | Definition                                                                                                 |
|------------------|------------------------------------------------------------------------------------------------------------|
| **Tool**         | A named unit of functionality with a Zod argument schema and an async handler function.                    |
| **Toolbox**      | A collection of tools that are built and injected together.                                                |
| **Stub**         | The compiled CLI binary injected into the sandbox. Parses args, writes requests, waits for responses.      |
| **Host Runtime** | The process running on the host that watches for requests, executes handlers, and writes responses.        |
| **Request**      | A JSON file written by the stub to the sandbox filesystem, representing a tool invocation.                 |
| **Response**     | A JSON file written by the host to the sandbox filesystem, containing the handler's return value or error. |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     HOST SIDE                           │
│                                                         │
│  ┌───────────────┐    ┌──────────────────────────────┐  │
│  │  Tool Defs    │    │  Host Runtime                │  │
│  │  (Zod + TS)   │───▶│  - watches /tsukumo/requests │  │
│  │               │    │  - executes handlers         │  │
│  └───────┬───────┘    │  - writes /tsukumo/responses │  │
│          │            └──────────────────────────────┘  │
│          │ build                     ▲                  │
│          ▼                           │ E2B SDK          │
│  ┌───────────────┐         watchDir()/write()/read()    │
│  │  Stub Binary  │                   │                  │
│  │  (Bun compile)│                   │                  │
│  └───────┬───────┘                   │                  │
│          │ inject                    │                  │
├──────────┼───────────────────────────┼──────────────────┤
│          ▼                           │                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │                SANDBOX (E2B microVM)             │   │
│  │                                                  │   │
│  │  /tsukumo/                                       │   │
│  │  ├── bin/                                        │   │
│  │  │   ├── tsukumo         ← actual binary         │   │
│  │  │   ├── greet           ← symlink → tsukumo     │   │
│  │  │   └── fetch-url       ← symlink → tsukumo     │   │
│  │  ├── requests/           ← stub writes here      │   │
│  │  │   └── {id}.json                               │   │
│  │  ├── responses/          ← host writes here      │   │
│  │  │   └── {id}.json                               │   │
│  │  └── manifest.json       ← tool registry         │   │
│  │                                                  │   │
│  │  User code:                                      │   │
│  │  $ greet --name "Ada"                            │   │
│  │  {"greeting":"Hello, Ada!"}                      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Busybox Pattern

A single compiled binary (`tsukumo`) is injected into the sandbox. For
each registered tool, a **symlink** is created pointing to this
binary. The binary inspects `process.argv[0]` to determine which tool
was invoked.

This avoids the ~50–90MB-per-binary overhead of Bun-compiled
executables. Ten tools cost the same as one.

If invoked as `tsukumo` directly (not via symlink), the binary acts as
a dispatcher and expects a subcommand:

```bash
# Via symlink (preferred)
greet --name "Ada"

# Via direct invocation
tsukumo greet --name "Ada"

# List available tools
tsukumo --list

# Show help for a tool
tsukumo greet --help
```

---

## 4. Tool Definition API

### 4.1 Defining a Tool

```typescript
// tools/greet.ts
import { defineTool } from 'tsukumo';
import { z } from 'zod';

export default defineTool({
  name: 'greet',
  description: 'Greets a person by name',

  args: z.object({
    name: z.string().describe('Name of the person to greet'),
    enthusiasm: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('How enthusiastic the greeting should be (1-10)'),
    formal: z
      .boolean()
      .default(false)
      .describe('Use formal greeting style'),
  }),

  handler: async (args) => {
    const excl = '!'.repeat(args.enthusiasm);
    const greeting = args.formal
      ? `Good day, ${args.name}.`
      : `Hey ${args.name}${excl}`;
    return { greeting };
  },
});
```

### 4.2 `defineTool` Signature

```typescript
interface ToolDefinition<TArgs extends z.ZodObject<any>, TResult> {
  /** Unique tool name. Used as CLI command name and symlink name. */
  name: string;

  /** Human-readable description. Shown in --help output. */
  description: string;

  /** Zod schema for the tool's arguments. Must be a z.object(). */
  args: TArgs;

  /**
   * Handler function executed on the HOST side.
   * Receives validated, typed arguments.
   * Returns a JSON-serializable value.
   */
  handler: (args: z.infer<TArgs>) => Promise<TResult> | TResult;

  /**
   * Optional timeout in milliseconds for the handler.
   * Defaults to 30_000 (30 seconds).
   */
  timeout?: number;
}

function defineTool<TArgs extends z.ZodObject<any>, TResult>(
  def: ToolDefinition<TArgs, TResult>
): Tool<TArgs, TResult>;
```

### 4.3 Creating a Toolbox

```typescript
// toolbox.ts
import { createToolbox } from 'tsukumo';
import greet from './tools/greet';
import fetchUrl from './tools/fetch-url';
import runQuery from './tools/run-query';

export const toolbox = createToolbox({
  tools: [greet, fetchUrl, runQuery],

  /**
   * Base path inside the sandbox where tsukumo files are placed.
   * Defaults to '/tmp/tsukumo'.
   */
  basePath: '/tmp/tsukumo',
});
```

---

## 5. Build Pipeline

The build step compiles a single stub binary that embeds all tool schemas
(but not handlers — those remain host-side only).

### 5.1 Build API

```typescript
import { toolbox } from './toolbox';

await toolbox.build({
  /**
   * Bun compilation targets.
   * Defaults to ['bun-linux-x64'].
   */
  targets: ['bun-linux-x64', 'bun-linux-arm64'],

  /**
   * Output directory for compiled binaries.
   * One binary per target, named: tsukumo-{target}
   */
  outDir: './dist',
});
```

### 5.2 What the Build Does

1. **Generates a CLI entry point** — A temporary TypeScript file that imports
   all tool schemas and wires up the argument parsing and request/response
   protocol.

2. **Compiles with Bun** — Runs `bun build --compile --target=<target>` for
   each specified target. The output is a standalone binary with zero
   external dependencies.

3. **Generates a manifest** — A `manifest.json` describing all tools, their
   argument schemas (as JSON Schema, derived from Zod), and metadata. This
   manifest is injected alongside the binary.

### 5.3 Manifest Format

```json
{
  "version": 1,
  "tools": [
    {
      "name": "greet",
      "description": "Greets a person by name",
      "args": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Name of the person to greet" },
          "enthusiasm": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 },
          "formal": { "type": "boolean", "default": false }
        },
        "required": ["name"]
      },
      "timeout": 30000
    }
  ]
}
```

### 5.4 Build-Time Schema Extraction

At build time, the Zod schemas need to be compiled into the stub binary
**without** pulling in the handler code. This is achieved by:

1. The generated CLI entry point imports only the schema portion of each
   tool definition.
2. `defineTool` returns an object where `handler` is a separate,
   tree-shakeable property.
3. The CLI entry point references `tool.args` and `tool.name` but never
   `tool.handler`, allowing Bun's bundler to eliminate handler code from the
   compiled binary.

---

## 6. Sandbox Injection

Injection uploads the compiled binary and sets up the communication channel.

### 6.1 Injection API

```typescript
import { Sandbox } from '@e2b/code-interpreter';
import { toolbox } from './toolbox';

const sandbox = await Sandbox.create();

// Inject tools and start watching for requests.
// Returns a handle for cleanup.
const handle = await toolbox.inject(sandbox, {
  /**
   * Which pre-built target to inject.
   * Must match a target from the build step.
   * Defaults to 'bun-linux-x64'.
   */
  target: 'bun-linux-x64',

  /**
   * Add /tsukumo/bin to the sandbox PATH.
   * Defaults to true.
   */
  addToPath: true,
});

// ... use sandbox ...

// Cleanup: stops watcher, optionally removes injected files.
await handle.dispose();
```

### 6.2 What Injection Does

1. **Creates directory structure** in the sandbox:
   ```
   /tmp/tsukumo/bin/
   /tmp/tsukumo/requests/
   /tmp/tsukumo/responses/
   ```

2. **Uploads the stub binary** to `/tmp/tsukumo/bin/tsukumo`.

3. **Sets executable permission** on the binary.

4. **Creates symlinks** for each tool:
   `greet → tsukumo`, `fetch-url → tsukumo`, etc.

5. **Writes `manifest.json`** to `/tmp/tsukumo/manifest.json`.

6. **Optionally updates PATH** by appending to the sandbox's shell profile
   (e.g., `export PATH="/tmp/tsukumo/bin:$PATH"` in `/home/user/.bashrc`).

7. **Starts the host-side watcher** (see §8).

### 6.3 Sandbox Backend Abstraction

While E2B is the primary target, injection is abstracted behind a
`SandboxBackend` interface:

```typescript
interface SandboxBackend {
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
  exec(command: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /**
   * Watch a directory for file creation events.
   * Calls the callback when a new file appears.
   * Returns a disposable handle.
   */
  watchDir(
    path: string,
    callback: (event: { type: string; name: string; path: string }) => void,
    opts?: { recursive?: boolean }
  ): Promise<Disposable>;

  /** Remove a file or directory. */
  remove(path: string): Promise<void>;
}
```

An E2B adapter implements this by delegating to `sandbox.files.*` and
`sandbox.commands.run()`. Other backends (Docker, local filesystem, etc.)
can implement the same interface.

---

## 7. Communication Protocol

### 7.1 Request File

When the stub CLI is invoked inside the sandbox, it:

1. Parses and validates CLI arguments against the tool's Zod schema.
2. Generates a unique request ID (UUIDv4).
3. Writes a request file to `/tmp/tsukumo/requests/{id}.json`.
4. Waits for the corresponding response at `/tmp/tsukumo/responses/{id}.json`.

**Request format:**

```json
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "tool": "greet",
  "args": {
    "name": "Ada",
    "enthusiasm": 7,
    "formal": false
  },
  "ts": 1712678400000
}
```

| Field  | Type   | Description                              |
|--------|--------|------------------------------------------|
| `v`    | number | Protocol version. Always `1`.            |
| `id`   | string | UUIDv4 unique to this invocation.        |
| `tool` | string | Tool name matching the manifest.         |
| `args` | object | Validated arguments.                     |
| `ts`   | number | Unix timestamp (ms) of the request.      |

### 7.2 Response File

The host runtime writes a response file after executing the handler.

**Success response:**

```json
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ok": true,
  "result": {
    "greeting": "Hey Ada!!!!!!!"
  },
  "ts": 1712678400123
}
```

**Error response:**

```json
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ok": false,
  "error": {
    "code": "HANDLER_ERROR",
    "message": "Database connection refused"
  },
  "ts": 1712678400456
}
```

| Field    | Type    | Description                                |
|----------|---------|--------------------------------------------|
| `v`      | number  | Protocol version.                          |
| `id`     | string  | Matches the request ID.                    |
| `ok`     | boolean | Whether the handler succeeded.             |
| `result` | any     | Handler return value (if `ok: true`).      |
| `error`  | object  | Error details (if `ok: false`).            |
| `ts`     | number  | Unix timestamp (ms) of the response.       |

### 7.3 Error Codes

| Code                | Cause                                       |
|---------------------|---------------------------------------------|
| `HANDLER_ERROR`     | Handler function threw an exception.        |
| `HANDLER_TIMEOUT`   | Handler exceeded its timeout.               |
| `UNKNOWN_TOOL`      | Request referenced an unregistered tool.    |
| `INVALID_REQUEST`   | Malformed request file.                     |
| `INTERNAL_ERROR`    | Unexpected error in the host runtime.       |

### 7.4 Atomic Write Protocol

Neither E2B's `files.write()` nor the sandbox-side `fs.writeFileSync()`
guarantee atomicity. A reader can observe a partially-written file. To
prevent this, **both sides use a write-then-rename pattern**:

1. Writer creates the file with a `.tmp` extension (e.g.,
   `requests/{id}.json.tmp`).
2. Writer renames (moves) the `.tmp` file to the final `.json` path.
3. Reader only processes `.json` files — `.tmp` files are invisible.

On POSIX filesystems, `rename(2)` is atomic within the same directory.
E2B sandboxes run Linux with ext4, so this guarantee holds. The host
side performs the rename via `sandbox.commands.run('mv ...')`.

### 7.5 File Lifecycle

1. Stub writes `requests/{id}.json.tmp`, then renames to
   `requests/{id}.json`.
2. Host detects the `.json` file via `watchDir`.
3. Host reads the request, removes it from `requests/`.
4. Host executes the handler.
5. Host writes `responses/{id}.json.tmp` via `sandbox.files.write()`,
   then renames to `responses/{id}.json` via
   `sandbox.commands.run('mv ...')`.
6. Stub detects the response file (via `fs.watch` or poll), reads it,
   removes it.
7. Both directories stay clean.

---

## 8. Host Runtime

### 8.1 Watcher

The host runtime uses **two complementary mechanisms** to detect requests:

1. **Primary: `watchDir`** — `sandbox.files.watchDir()` (E2B) monitors
   `/tmp/tsukumo/requests/` for `CREATE`/`WRITE` events on `.json` files.
   This provides low-latency detection in the common case.

2. **Secondary: reconciliation poll** — A periodic scan of the
   `requests/` directory via `sandbox.files.list()` catches any events
   that `watchDir` missed. E2B's watch is built on Linux inotify inside
   the Firecracker VM; inotify can drop events when the kernel event
   queue overflows under sustained load. The poll interval defaults to
   **500ms** (configurable). Already-processed request IDs are tracked
   in a short-lived in-memory set to avoid duplicate handling.

On detecting a new request file:

1. Read the file content via `sandbox.files.read()`.
2. Parse and validate the request JSON.
3. Look up the tool handler by `request.tool`.
4. Execute the handler with `request.args`.
5. Write the response using the atomic write protocol (§7.4):
   write `responses/{id}.json.tmp`, rename to `responses/{id}.json`.
6. Clean up the request file via `sandbox.files.remove()`.

### 8.2 Concurrency

Multiple tool invocations can happen simultaneously (different processes in
the sandbox call different tools, or the same tool concurrently). The host
runtime handles this naturally:

- Each request has a unique ID, so there are no file collisions.
- Handlers run concurrently (they're async functions).
- The watcher processes events as they arrive.

An optional concurrency limit can be configured to prevent overwhelming the
host:

```typescript
const toolbox = createToolbox({
  tools: [...],
  maxConcurrency: 10, // max simultaneous handler executions
});
```

### 8.3 Error Handling

| Scenario                        | Behavior                                           |
|---------------------------------|----------------------------------------------------|
| Handler throws                  | Response with `ok: false`, `HANDLER_ERROR`          |
| Handler exceeds timeout         | Response with `ok: false`, `HANDLER_TIMEOUT`        |
| Unknown tool name               | Response with `ok: false`, `UNKNOWN_TOOL`           |
| Malformed request JSON          | Response with `ok: false`, `INVALID_REQUEST`        |
| Host watcher crashes            | Sandbox-side stubs time out; CLI exits with code 2  |

---

## 9. CLI Stub (Sandbox Side)

### 9.1 Argument Parsing

The stub uses [`zod-opts`](https://github.com/ndruger/zod-opts) (v1.0.0,
MIT) to convert Zod schemas into CLI argument parsers. `zod-opts` was
selected because:

- **Subcommand support** — Its `command()` / `.subcommand()` API maps
  directly to our busybox pattern (each tool is a subcommand).
- **Native Zod integration** — Accepts Zod types directly in `.options()`,
  preserving `.describe()`, `.default()`, `.optional()`, refinements, etc.
- **Zod v3 + v4 support** — Forward-compatible.
- **Pure TypeScript** — No native bindings, compiles cleanly with
  `bun build --compile`.
- **Built-in help generation** — Free `--help` with descriptions, defaults,
  choices, and required markers.
- **Boolean negation** — Supports `--no-flag` out of the box.

The mapping from our `z.object()` tool schemas to zod-opts' API is a thin
bridge:

```typescript
// Bridge: tool.args (z.object) → zod-opts .options()
function zodShapeToOpts(shape: z.ZodRawShape) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, zodType]) => [key, { type: zodType }])
  );
}
```

**Type mapping (handled by zod-opts):**

| Zod Type              | CLI Flag                | Example                    |
|-----------------------|-------------------------|----------------------------|
| `z.string()`          | `--name <string>`       | `--name "Ada"`             |
| `z.number()`          | `--age <number>`        | `--age 30`                 |
| `z.boolean()`         | `--flag` / `--no-flag`  | `--formal` / `--no-formal` |
| `z.enum([...])`       | `--level <string>`      | `--level high`             |
| `z.array(z.string())` | `--tag <string ...>`    | `--tag a b`                |
| `.optional()`         | flag is optional        |                            |
| `.default(val)`       | flag has default value  |                            |
| `.describe(text)`     | shown in `--help`       |                            |

### 9.2 Invocation Flow

```
greet --name "Ada" --enthusiasm 7
     │
     ▼
┌─ CLI Stub ──────────────────────────────────────┐
│  1. Detect tool name from argv[0] or subcommand │
│  2. Parse CLI flags                             │
│  3. Validate against Zod schema                 │
│  4. Generate request ID (UUIDv4)                │
│  5. Write /tmp/tsukumo/requests/{id}.json       │
│  6. Watch /tmp/tsukumo/responses/{id}.json      │
│  7. ── block until response appears ──          │
│  8. Read response                               │
│  9. Delete response file                        │
│ 10. If ok: print result to stdout, exit 0       │
│     If error: print error to stderr, exit 1     │
│     If timeout: print timeout to stderr, exit 2 │
└─────────────────────────────────────────────────┘
```

### 9.3 Response Wait Strategy

The stub blocks after writing the request, waiting for the response file.

**Strategy: `fs.watch` with poll fallback**

```
attempt fs.watch on responses/{id}.json parent dir
  if watch fires and file exists → read and return
  if watch not supported → fall back to polling

polling:
  loop every 50ms (configurable):
    if responses/{id}.json exists → read and return
    if elapsed > timeout → exit with TIMEOUT
```

The default timeout for the stub is **60 seconds** (configurable per-tool
and via `--timeout <ms>` CLI flag).

### 9.4 Exit Codes

| Code | Meaning                                      |
|------|----------------------------------------------|
| 0    | Success. Result printed to stdout as JSON.   |
| 1    | Error. Handler error or validation failure.  |
| 2    | Timeout. No response within the time limit.  |

### 9.5 Output

**stdout:** On success, the tool's result is printed as a single line of
JSON followed by a newline. This makes it easy to capture and parse
programmatically.

```bash
$ greet --name "Ada"
{"greeting":"Hey Ada!!!!!"}
```

**stderr:** On error, a human-readable error message is printed.

```bash
$ greet
Error: Missing required argument: --name
Usage: greet --name <string> [--enthusiasm <number>] [--formal]
```

---

## 10. Developer Experience

### 10.1 Minimal Example (End to End)

```typescript
// 1. Define a tool
import { defineTool, createToolbox } from 'tsukumo';
import { z } from 'zod';

const echo = defineTool({
  name: 'echo',
  description: 'Echoes the input back',
  args: z.object({
    message: z.string().describe('Message to echo'),
  }),
  handler: async ({ message }) => ({ echoed: message }),
});

// 2. Create a toolbox and build
const toolbox = createToolbox({ tools: [echo] });
await toolbox.build({ targets: ['bun-linux-x64'] });

// 3. Inject into a sandbox
import { Sandbox } from '@e2b/code-interpreter';
const sandbox = await Sandbox.create();
const handle = await toolbox.inject(sandbox);

// 4. Now code running inside the sandbox can call:
//    $ echo --message "hello"
//    {"echoed":"hello"}

// 5. Cleanup
await handle.dispose();
await sandbox.kill();
```

### 10.2 Project Structure (Recommended)

```
my-agent/
├── tools/
│   ├── search-web.ts
│   ├── read-database.ts
│   └── send-email.ts
├── toolbox.ts           # createToolbox({ tools: [...] })
├── build.ts             # toolbox.build({ ... })
├── agent.ts             # sandbox creation + toolbox.inject()
├── dist/                # compiled binaries (git-ignored)
│   ├── tsukumo-bun-linux-x64
│   └── manifest.json
└── package.json
```

---

## 11. Package Anatomy

```
tsukumo/
├── src/
│   ├── index.ts              # Public API: defineTool, createToolbox
│   ├── define.ts             # defineTool implementation
│   ├── toolbox.ts            # createToolbox, build, inject
│   ├── protocol.ts           # Request/response types, version
│   ├── build/
│   │   ├── compiler.ts       # Bun compilation wrapper
│   │   ├── codegen.ts        # CLI entry point code generation
│   │   └── manifest.ts       # Manifest generation (Zod → JSON Schema)
│   ├── host/
│   │   ├── runtime.ts        # Host-side watcher + handler executor
│   │   └── concurrency.ts    # Concurrency limiter
│   ├── cli/
│   │   ├── runner.ts         # Stub entry point (compiled into binary)
│   │   ├── bridge.ts         # Zod z.object() → zod-opts .options() bridge
│   │   └── wait.ts           # Response wait strategy (watch + poll)
│   └── backends/
│       ├── interface.ts      # SandboxBackend interface
│       └── e2b.ts            # E2B adapter
├── package.json
├── tsconfig.json
└── SPEC.md
```

---

## 12. Key Decisions & Tradeoffs

### D1: Single Binary (Busybox) vs. One Binary Per Tool

**Decision:** Single binary with symlinks.

**Rationale:** Bun-compiled binaries embed the entire runtime (~50–90MB).
Shipping N copies for N tools is wasteful. The busybox pattern gives us N
commands for the cost of one binary plus N negligible symlinks.

**Tradeoff:** Slightly more complex build (all schemas must be compiled
into one binary). Invocation-name detection via `argv[0]` is a well-known
Unix pattern and works reliably.

### D2: Filesystem-Based RPC vs. Other Transports

**Decision:** JSON files in request/response directories.

**Rationale:** The filesystem is the lowest-common-denominator transport
available in every sandbox environment. E2B provides `watchDir` with
millisecond-level latency. No need for sockets, HTTP servers, or pipes
that may not be available or may require additional sandbox configuration.

**Tradeoff:** Latency is higher than a socket (~10–50ms per round trip
due to file I/O + watch propagation). For tool calls that do meaningful
work (API calls, DB queries), this overhead is negligible. Not suitable
for high-frequency, low-latency RPCs — but that's not the use case.

### D3: Host-Side Execution vs. Sandbox-Side Execution

**Decision:** Tool handlers run on the host.

**Rationale:** Tools typically need access to resources outside the
sandbox (APIs, databases, credentials). Running on the host avoids
leaking secrets into the sandbox and avoids network restrictions.

**Tradeoff:** Every tool call incurs a filesystem round trip. Pure
compute tools would be faster running directly in the sandbox. V1
optimizes for the common case (I/O-bound tools); compute-bound tools
can be addressed later.

### D4: Zod-to-CLI via `zod-opts`

**Decision:** Use [`zod-opts`](https://github.com/ndruger/zod-opts) (v1.0.0,
MIT, pure TypeScript) rather than building our own adapter.

**Rationale:** Initially considered building internally, but `zod-opts`
earns its place for three reasons: (1) its **subcommand API** maps
perfectly to our busybox pattern — each tool becomes a `command()` with
its own `.options()` and `.action()`, (2) it already handles all the
types we need including boolean negation and arrays, and (3) it supports
both Zod v3.25+ and Zod v4, which future-proofs us. The library is pure
TypeScript with zero runtime dependencies beyond Zod, so it compiles
cleanly with `bun build --compile`. The bridge from our `z.object()`
tool schemas to zod-opts' format is ~5 lines.

**Tradeoff:** Small community (20 stars, single maintainer). The
library is well-tested (CI + codecov) and at v1.0.0, but if it becomes
unmaintained, we'd need to fork or replace. The blast radius is
contained: `zod-opts` only runs inside the compiled stub binary, not in
host-side code. If we ever outgrow it, the bridge layer makes swapping
straightforward.

### D5: JSON-Only Output

**Decision:** Stdout is always JSON.

**Rationale:** Simplicity. Tools are called programmatically by code
running in the sandbox, not by humans. JSON is universally parseable.

**Tradeoff:** Less human-friendly when debugging manually. Mitigated by
pretty-printing on stderr when `--verbose` is passed, and by the
`--help` flag providing clear usage info.

---

## 13. Future Considerations

Items explicitly out of scope for v1 but worth noting for the roadmap:

- **Streaming responses.** Chunked delivery via a numbered-file pattern
  (`responses/{id}.0.json`, `responses/{id}.1.json`, ...) or a single
  file with append semantics.

- **Bidirectional tools.** Host → sandbox invocations using the same
  protocol in reverse.

- **Binary payloads.** File references in the response that point to
  binary blobs in a separate `blobs/` directory.

- **Runtime tool registration.** Hot-loading new tools without
  restarting the sandbox (requires a watcher on `manifest.json`
  changes or a registration endpoint).

- **Tool middleware.** Interceptors for logging, rate limiting, auth
  checks, etc., applied at the host runtime level.

- **Sandbox-side SDK.** A lightweight TypeScript/Python library for the
  sandbox that wraps the CLI call with proper JSON parsing and error
  handling, for use by code running inside the sandbox.

- **Pre-built binary caching.** Avoid recompiling when tool schemas
  haven't changed (hash-based cache keyed on schema content).

---

## 14. Resolved Questions

> Previously open, now resolved through research and testing.

### R1: Symlink support in E2B — CONFIRMED

`sandbox.commands.run('ln -s <target> <link>')` works. The E2B adapter's
`symlink()` method delegates to this. No fallback to shell-script
wrappers is needed.

### R2: File atomicity — RESOLVED (write-then-rename)

E2B's `files.write()` does **not** guarantee atomicity. The E2B SDK
delegates to the Firecracker VM's filesystem, and there is no
documentation of atomic-write guarantees.

**Solution:** Both sides use the write-then-rename pattern (§7.4).
Write to `{id}.json.tmp`, then `rename` / `mv` to `{id}.json`. POSIX
`rename(2)` is atomic on ext4 (the sandbox filesystem). Readers only
process `.json` files, never `.tmp`.

### R3: Watch reliability — RESOLVED (watch + reconciliation poll)

E2B's `watchDir` is built on Linux inotify inside the Firecracker VM.
Events are delivered asynchronously and can be **delayed**. Under
sustained write load, inotify can also **drop** events if the kernel
event queue overflows.

**Solution:** The host runtime uses dual detection (§8.1): `watchDir`
for low-latency pickup, plus a periodic reconciliation poll
(`sandbox.files.list()` every 500ms) that catches any missed events.
Already-processed IDs are tracked in memory to deduplicate.

---

## 15. Open Questions

> These need resolution before or during implementation.

1. **PATH injection strategy.** The sandbox needs `/tmp/tsukumo/bin` in
   PATH for tool commands to be callable without full paths. Appending
   to `.bashrc` / `.profile` covers interactive shells, but
   non-interactive process invocations (e.g., subprocess spawns from
   code) won't see it. Options under consideration:
   - (a) Write to `/etc/environment` (system-wide, survives resume).
   - (b) Write a wrapper script per tool to `/usr/local/bin/` (which
     is typically in PATH already).
   - (c) Document that callers must use full paths or set PATH
     themselves, and inject PATH info into the manifest.
   - (d) Use `sandbox.commands.run('export ...')` as a prefix.
   Agents running in the sandbox will need clear instructions on
   where to find tools. This intersects with DX — the toolbox should
   provide a discoverable way for sandbox-side code to learn the
   tool paths.

2. **Sandbox resume semantics.** When an E2B sandbox is resumed from a
   snapshot, the host-side watcher does not survive (it was running in
   a previous process). The `inject()` API needs to handle two cases:
   - **Fresh sandbox** — full injection (upload binary, create
     symlinks, create directories, start watcher).
   - **Resumed sandbox** — binary and symlinks may already exist.
     Only restart the watcher. Should also drain any stale requests
     that were written before the pause (respond with a
     `STALE_REQUEST` error or re-process them).
   Consider splitting `inject()` into `inject()` + `attach()`, where
   `attach()` reconnects to an already-injected sandbox.

3. **E2B sandbox persistence bug.** E2B has a known issue
   ([e2b-dev/E2B#884](https://github.com/e2b-dev/e2b/issues/884))
   where file changes are lost after the second pause/resume cycle.
   This could affect our binary and manifest persistence. Monitor
   this issue and test resume behavior explicitly during
   implementation. May need to re-upload on every resume as a
   workaround.
