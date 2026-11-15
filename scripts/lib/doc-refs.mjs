/**
 * Sync layer 5: the names a doc gives for code must exist in code. Pure: the
 * CLI in scripts/check-doc-refs.mjs supplies the tracked files and the words.
 */

// Only inline spans count, so a token must start with a repo root to be a path.
const ROOTS = ["apps/", "crates/", "packages/", "scripts/", "db/", "docs/", "infra/", "python/", "plugins/", ".github/"];
const PATH_NOISE = /[\s*<{]|\.\.\./;
const SCOPED = /^[A-Za-z_]\w*(?:::\w+)+$/;
const CODE_FILE = /^[A-Za-z0-9_.-]+\.(?:ts|tsx|mjs|js|rs|py|css|sql|json|toml|md|yml|yaml)$/;
const SNAKE = /^_*[a-z][a-z0-9]*_[a-z0-9_]*$/;
const CAMEL = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;

const snakeToCamel = (name) => name.replace(/_+([a-z0-9])/g, (_, c) => c.toUpperCase());
const camelToSnake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
// `/target/` should match `crates/x/target/debug`, so compare whole segments.
const segments = (text) => `/${text.replace(/^\/+|\/+$/g, "")}/`;

function pathToken(token) {
  if (PATH_NOISE.test(token) || !ROOTS.some((root) => token.startsWith(root))) return null;
  return token.replace(/:\d+(?:-\d+)?$/, "").replace(/\/$/, "");
}

// A bare name has no "/", so it is checked by basename; globs and placeholders never match CODE_FILE.
function fileToken(token) {
  const name = token.replace(/^\.\//, "").replace(/:\d+(?:-\d+)?$/, "");
  return CODE_FILE.test(name) ? name : null;
}

function identToken(token) {
  if (/\s/.test(token)) return null;
  if (SCOPED.test(token)) {
    const last = token.split("::").pop();
    return last.length >= 3 ? last : null;
  }
  if (token.length < 3) return null;
  return SNAKE.test(token) || CAMEL.test(token) ? token : null;
}

/** Inline code refs in a markdown page, with 1-based lines. */
export function extractRefs(markdown) {
  const paths = [];
  const idents = [];
  const files = [];
  let generated = null;
  let fenced = false;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const at = index + 1;
    if (generated) {
      if (line.includes(`<!-- /generated:${generated} -->`)) generated = null;
      return;
    }
    const open = line.match(/<!-- generated:(\S+) -->/);
    if (open) {
      generated = open[1];
      return;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
      const token = span.trim();
      const path = pathToken(token);
      if (path) {
        paths.push({ text: path, line: at });
        continue;
      }
      const file = fileToken(token);
      if (file) {
        files.push({ text: file, line: at });
        continue;
      }
      const ident = identToken(token);
      if (ident) idents.push({ text: ident, line: at });
    }
  });
  return { paths, idents, files };
}

const allowed = (token, allow) => allow.some((entry) => segments(token).includes(segments(entry)));

/** Paths that are neither tracked files, directories above one, nor allowlisted. */
export function missingPaths(paths, trackedSet, allow) {
  const known = new Set();
  for (const file of trackedSet) {
    let dir = file;
    while (dir.includes("/")) {
      dir = dir.slice(0, dir.lastIndexOf("/"));
      if (known.has(dir)) break;
      known.add(dir);
    }
    known.add(file);
  }
  return paths.filter(({ text }) => !known.has(text) && !allowed(text, allow));
}

/** Bare file names whose basename is no tracked file's basename, nor allowlisted. */
export function missingFiles(files, trackedSet, allow) {
  const names = new Set([...trackedSet].map((file) => file.slice(file.lastIndexOf("/") + 1)));
  return files.filter(({ text }) => !names.has(text) && !allowed(text, allow));
}

/** Identifiers that appear in no source word, in either snake or camel form. */
export function missingIdents(idents, wordSet, allow) {
  return idents.filter(
    ({ text }) =>
      !wordSet.has(text) &&
      !wordSet.has(snakeToCamel(text)) &&
      !wordSet.has(camelToSnake(text)) &&
      !allowed(text, allow),
  );
}

/** Sorted unique `crates/<x>`, `apps/<x>`, `packages/<x>` roots that hold a tracked file. */
export function codeRoots(trackedPaths) {
  const roots = new Set();
  for (const rel of trackedPaths) {
    const root = rel.match(/^(?:crates|apps|packages)\/[^/]+(?=\/)/)?.[0];
    if (root) roots.add(root);
  }
  return [...roots].sort();
}

/** Code roots that have no `dir` row in AREAS. */
export function missingAreaRows(roots, areaDirs) {
  const rows = new Set(areaDirs);
  return roots.filter((root) => !rows.has(root));
}
