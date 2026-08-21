/**
 * The MCP tool list, read from the one place it is declared.
 *
 * `AI_TOOL_NAMES` in core is the source of truth. Two build scripts need it and
 * neither can import it: they run before the TypeScript build and outside the
 * bundler that resolves `@weaveforge/core`. Both used to keep a hand-written
 * copy of the list instead, so adding a tool meant editing it in three places
 * and the build stayed green when you edited two.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "packages/core/src/features/ai-assistant/domain/ai-types.ts";

/** @param {string} root repo root @returns {string[]} tool names, in declared order */
export function readAiToolNames(root) {
  const source = readFileSync(join(root, SOURCE), "utf8");
  const block = /export const AI_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(source)?.[1];
  if (!block) throw new Error(`Could not find AI_TOOL_NAMES in ${SOURCE}.`);
  const names = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  if (names.length === 0) throw new Error(`AI_TOOL_NAMES in ${SOURCE} parsed as empty.`);
  return names;
}
