import { rust } from "@weaveforge/core";
import type { VaultSession } from "./vault-handlers";
import { listVaultFiles, readVaultFile } from "./vault-handlers";

/**
 * Searching the vault folder, shared by the local REST API and the MCP surface.
 * It lives here rather than in either so neither imports the other (37-16).
 * The match, cut and skip rules are Rust (`vault_search`); the walk and reads stay here.
 */

/** How many files a search will read before it stops. */
const SEARCH_LIMIT = 2_000;

/** Every file under `dir`, depth-first, up to a cap. */
export async function walkVault(session: VaultSession, dir: string, out: string[]): Promise<void> {
  if (out.length >= SEARCH_LIMIT) return;
  const listed = await listVaultFiles(session, dir);
  if (!listed.ok) return;
  for (const entry of listed.value) {
    if (out.length >= SEARCH_LIMIT) return;
    // `.git` alone can hold thousands of objects and spend the cap before any project.
    if (entry.kind === "dir" && rust().isSkippedDir(entry.path)) continue;
    if (entry.kind === "dir") await walkVault(session, entry.path, out);
    else out.push(entry.path);
  }
}

export interface VaultSearchHit {
  filename: string;
  matches: { context: string }[];
}

/**
 * Which markdown files under `dir` mention `query`, and the lines that did.
 *
 * Shared with the MCP surface rather than reimplemented there: two searches
 * over one folder would eventually disagree about what counts as a match, and
 * the one an agent uses is not the one a person would notice was wrong.
 */
export async function searchVault(
  session: VaultSession,
  query: string,
  dir = "",
): Promise<VaultSearchHit[]> {
  const files: string[] = [];
  await walkVault(session, dir, files);

  const results: VaultSearchHit[] = [];
  for (const filename of files) {
    if (!rust().isSearchFile(filename)) continue;
    const read = await readVaultFile(session, filename);
    if (!read.ok || read.value === null) continue;
    // One file that mentions the word forty times is one result worth showing,
    // not forty; the cap of five per file lives in the Rust rule.
    const contexts = rust().searchMatches(read.value, query) as string[];
    if (contexts.length) results.push({ filename, matches: contexts.map((context) => ({ context })) });
  }
  return results;
}
