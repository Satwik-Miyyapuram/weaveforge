/**
 * What a link row may say, decided once.
 *
 * These three rules are the whole of the validation a linked report needs, and
 * they have to hold in two places: the API route a browser posts to, and the
 * desktop path, where there is no route and the page writes the row itself. A
 * second, hand-kept copy of a rule that decides what goes into a clone URL is
 * not a rule — so there is one, here, with no imports.
 */

/** Overleaf project ids appear in a clone URL, so keep them to safe path atoms. */
export const OVERLEAF_PROJECT_ID = /^[A-Za-z0-9_-]+$/;
const ENTRY_FILE = /^[A-Za-z0-9._/-]+$/;

export function entryFileError(entryFile: string): string | null {
  if (!ENTRY_FILE.test(entryFile) || entryFile.startsWith("/") || entryFile.includes("..")) {
    return "Entry file path is invalid.";
  }
  return null;
}

/**
 * The project id from what a user pastes: the id itself, the project's page
 * (`https://www.overleaf.com/project/<id>`) or its git URL
 * (`https://git.overleaf.com/<id>`). Null when it is none of those.
 */
export function parseOverleafProjectId(raw: string): string | null {
  const text = raw.trim();
  if (OVERLEAF_PROJECT_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const id =
    url.hostname === "git.overleaf.com" && parts.length === 1
      ? parts[0]
      : /^(www\.)?overleaf\.com$/.test(url.hostname) && parts.length === 2 && parts[0] === "project"
        ? parts[1]
        : undefined;
  return id && OVERLEAF_PROJECT_ID.test(id) ? id : null;
}

/** The clone URL; built from a checked id, never from what was pasted. */
export function overleafGitUrl(overleafProjectId: string): string {
  return `https://git.overleaf.com/${overleafProjectId}`;
}

/** Canonical, never user-supplied: this link sits beside a stored credential. */
export function externalUrl(overleafProjectId: string): string {
  return `https://www.overleaf.com/project/${overleafProjectId}`;
}

/**
 * Validates the { sectionKey -> targetWords } map the client sends. Keys are
 * lowercased title paths; values are positive whole-word targets, or null to
 * clear one. Anything malformed is rejected rather than silently stored.
 */
export function sanitizeSectionTargets(input: unknown): Record<string, number> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key || key.length > 500) return null;
    if (value === null) continue; // cleared target — drop the key
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 10_000_000) return null;
    out[key] = value;
  }
  return out;
}
