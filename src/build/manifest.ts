/**
 * Manifest generation — converts Zod schemas to JSON Schema and
 * produces the manifest.json file. See SPEC.md §5.3.
 */

import type { Tool } from "../define.ts";

/** Shape of a single tool entry in the manifest. */
export interface ManifestTool {
  name: string;
  description: string;
  args: Record<string, unknown>;
  timeout: number;
}

/** Top-level manifest format. */
export interface Manifest {
  version: 1;
  tools: ManifestTool[];
}

/**
 * Generate a manifest from a list of tools.
 * Converts each tool's Zod schema to JSON Schema for the manifest.
 */
export function generateManifest(tools: Tool[]): Manifest {
  // TODO: implement Zod → JSON Schema conversion using zod-to-json-schema
  void tools;
  throw new Error("Not implemented");
}
