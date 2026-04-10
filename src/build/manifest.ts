/**
 * Manifest generation — converts Zod schemas to JSON Schema and
 * produces the manifest.json file. See SPEC.md §5.3.
 */

import { zodToJsonSchema } from "zod-to-json-schema";

import type { z } from "zod";

/**
 * Minimal tool shape for manifest generation.
 *
 * Uses `z.ZodTypeAny` for `args` instead of the full `Tool` generic to
 * avoid handler contravariance issues when accepting heterogeneous tool
 * arrays. Since manifest generation never touches the handler, only
 * schema metadata fields are required.
 */
interface ManifestToolInput {
  readonly name: string;
  readonly description: string;
  readonly args: z.ZodTypeAny;
  readonly timeout: number;
}

/** Shape of a single tool entry in the manifest. */
export interface ManifestTool {
  /** Tool name, used as CLI command and symlink name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** JSON Schema representation of the tool's Zod argument schema. */
  args: Record<string, unknown>;
  /** Handler timeout in milliseconds. */
  timeout: number;
}

/** Top-level manifest format. */
export interface Manifest {
  /** Manifest format version. Always `1`. */
  version: 1;
  /** Array of tool definitions with JSON Schema args. */
  tools: ManifestTool[];
}

/**
 * Convert a single tool to its manifest representation.
 *
 * Uses `zod-to-json-schema` to translate the Zod argument schema into
 * a JSON Schema object. The `$schema` meta-field is stripped from the
 * output since the manifest carries its own versioning.
 */
function toolToManifestEntry(tool: ManifestToolInput): ManifestTool {
  const jsonSchema = zodToJsonSchema(tool.args, {
    $refStrategy: "none",
    target: "jsonSchema7",
  });

  // Strip the $schema meta-field — the manifest carries its own version.
  const { $schema: _, ...args } = jsonSchema;

  return {
    name: tool.name,
    description: tool.description,
    args,
    timeout: tool.timeout,
  };
}

/**
 * Generate a manifest from a list of tools.
 *
 * Converts each tool's Zod schema to JSON Schema via `zod-to-json-schema`
 * and produces the `Manifest` structure described in SPEC.md §5.3.
 */
export function generateManifest(tools: readonly ManifestToolInput[]): Manifest {
  return {
    version: 1,
    tools: tools.map(toolToManifestEntry),
  };
}
