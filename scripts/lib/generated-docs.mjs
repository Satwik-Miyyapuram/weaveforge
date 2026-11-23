/**
 * Files `npm run docs:generate` writes. The pre-push runner commits only
 * these, so other docs being edited by hand stay out of the commit.
 * Run directly, it prints them one per line.
 */

import { fileURLToPath } from "node:url";

export const GENERATED_DOCS = [
  "docs/building/architecture-map.md",
  "docs/building/mcp.md",
  "docs/building/dev.md",
  "docs/atlas.html",
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(GENERATED_DOCS.join("\n"));
}
