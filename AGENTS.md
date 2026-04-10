# AGENTS.md

## Project Overview

Tsukumo is a TypeScript library for defining tools with Zod-typed arguments and injecting
them into sandboxes (primarily E2B Firecracker microVMs) as callable CLI commands. Tool logic
runs host-side; a thin compiled CLI stub binary lives inside the sandbox. Communication uses
a filesystem-based JSON request/response protocol.

- **Runtime:** Bun
- **Language:** TypeScript (strict mode)
- **Module system:** ESM (`"type": "module"`)
- **Package manager:** Bun (`bun.lock`)
- **Single package** (not a monorepo)

## Build & Development Commands

```bash
# Install dependencies
bun install

# Type-check (no emit)
bun run typecheck        # runs: tsc --noEmit

# Run all tests
bun test

# Run a single test file
bun test src/define.test.ts

# Run tests matching a name pattern
bun test --filter "defineTool"

# Run tests in a specific directory
bun test src/host/
```

There is no build/bundle step for the library itself -- `package.json` exports point
directly to `.ts` source files. Consumers use a bundler.

The dev environment can be set up via Nix: `nix develop` provides Bun.

## Project Structure

```
src/
  index.ts              # Public API barrel (re-exports)
  define.ts             # defineTool() implementation
  protocol.ts           # Request/response types, error/exit codes
  toolbox.ts            # createToolbox()
  backends/
    interface.ts        # SandboxBackend interface
    e2b.ts              # E2B adapter implementation
  build/
    codegen.ts          # CLI entry point code generation
    compiler.ts         # Bun compilation wrapper
    manifest.ts         # Manifest generation
  cli/
    bridge.ts           # zodShapeToOpts() Zod-to-CLI bridge
    runner.ts           # CLI stub entry point
    wait.ts             # Response wait strategy
  host/
    runtime.ts          # Host watcher/executor
    concurrency.ts      # ConcurrencyLimiter async semaphore
```

The design specification is in `SPEC.md`. The implementation roadmap is in `TODO.md`.

## Code Style

### Formatting

- **Indentation:** 2 spaces
- **Quotes:** Double quotes for strings
- **Semicolons:** Always
- **Trailing commas:** Yes, in multi-line constructs
- **Braces:** Opening brace on same line
- No linter or formatter is configured -- follow existing code conventions

### Imports

- **Named imports only** -- never use default imports
- **Use `import type` for type-only imports** (enforced by `verbatimModuleSyntax`)
- **Include `.ts` extension** in all relative imports (e.g., `"./define.ts"`)
- Order: external packages first, then internal/relative imports

```typescript
import type { z } from "zod";
import type { Tool } from "./define.ts";
```

### Exports

- **Named exports only** -- never use default exports
- `src/index.ts` is the public API barrel file; use `export type` for type re-exports
- No intermediate barrel files in subdirectories

### Naming Conventions

| Element              | Convention           | Example                          |
|----------------------|----------------------|----------------------------------|
| Files                | `camelCase.ts`       | `codegen.ts`, `runtime.ts`       |
| Directories          | `lowercase`          | `cli/`, `backends/`              |
| Interfaces           | `PascalCase`         | `SandboxBackend`, `WatchEvent`   |
| Type aliases         | `PascalCase`         | `ToolResponse`, `ErrorCode`      |
| Classes              | `PascalCase`         | `ConcurrencyLimiter`             |
| Functions            | `camelCase`          | `defineTool`, `createToolbox`    |
| Constants            | `UPPER_SNAKE_CASE`   | `PROTOCOL_VERSION`               |
| Const objects        | `PascalCase` key     | `ExitCode.SUCCESS`               |
| Generic params       | `T`-prefixed         | `TArgs`, `TResult`               |
| Unused params        | `_` prefix           | `_config`, `_options`            |

### Types

- Prefer `interface` for object shapes; use `type` only for unions/aliases
- All exported functions must have explicit return types
- Use `readonly` on interface properties that should not be mutated
- Use `satisfies` for inline type-checking of returned object literals
- Use `as const` for constant object literals
- Generic constraints: `TArgs extends z.ZodObject<z.ZodRawShape>`

### Functions

- Use `function` declarations for all module-level exported functions (not arrow functions)
- Arrow functions for: callbacks, closures, `.map()` lambdas, handler signatures
- Method shorthand in object literals: `async writeFile(path, content) { ... }`

### Error Handling

- Typed error codes via string literal union: `ErrorCode`
- Discriminated union for responses: `ToolResponse` with `ok: true | false`
- Exit codes as const object: `ExitCode = { SUCCESS: 0, ERROR: 1, TIMEOUT: 2 } as const`
- Use `try/finally` for cleanup (e.g., semaphore release), not `try/catch` unless handling
- Throw `new Error(...)` for exceptional/unrecoverable conditions

### Async Patterns

- Standard `async function` with `await`
- Return `Promise<void>` for side-effectful async operations
- Handlers may be sync or async: `(args: ...) => Promise<TResult> | TResult`
- Manual `Promise` construction only when necessary (e.g., semaphore queues)
- Use `try/finally` for cleanup in async contexts

### Documentation

- Every exported symbol (function, interface, type, constant) must have a `/** ... */` JSDoc comment
- Interface members should also have JSDoc comments
- Every file starts with a module-level `/** ... */` comment explaining purpose and referencing SPEC.md sections
- Use `// TODO:` for unimplemented sections, `// NOTE:` for caveats
- No `@param`/`@returns` JSDoc tags -- rely on TypeScript types instead

## TypeScript Configuration

Key strict settings from `tsconfig.json`:

- `"strict": true`
- `"verbatimModuleSyntax": true` -- forces `import type` for type-only imports
- `"noFallthroughCasesInSwitch": true`
- `"noUncheckedIndexedAccess": true` -- indexed access returns `T | undefined`
- `"noImplicitOverride": true`
- `"allowImportingTsExtensions": true` -- allows `.ts` in import paths
- Target: `ESNext`, module resolution: `bundler`

## Testing

Tests use Bun's built-in test runner. Test files should be co-located with source files
using the `*.test.ts` naming convention (e.g., `src/define.test.ts`). No test configuration
file is needed beyond `package.json`.

## Key Dependencies

- `zod` (peer) -- schema validation and type inference
- `zod-opts` -- CLI argument parsing from Zod schemas
- `zod-to-json-schema` -- manifest generation (Zod schemas to JSON Schema)
