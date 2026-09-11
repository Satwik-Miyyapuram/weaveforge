/**
 * The one search the boundary gates use, so the accelerator and the fallback
 * cannot disagree.
 *
 * `check:solid` and `check:dry` were written as `execSync("rg …")` calls and
 * shared one failure mode: a spawn that fails is reported as exit code 1 and
 * read as "no matches", so on a machine without ripgrep both gates exited 0
 * having verified nothing. That is not a hypothetical on Windows, where Node
 * runs the command through `cmd.exe` and `'rg' is not recognized` is exit 1 —
 * the same code ripgrep itself uses to mean "found nothing". Two rules in
 * `check-solid.mjs` went further and swallowed every error with a bare
 * `catch { return []; }`, which is the same silence without even the excuse of
 * a missing binary.
 *
 * So the search is implemented here once, in Node, over an explicit file list.
 * ripgrep is still tried first because it is a compiled scanner and this is a
 * regex over a few thousand files; if it is absent, unusable, or exits with a
 * code that means anything other than "matched" or "matched nothing", the same
 * rules run over the same files in Node. There is no third behaviour to drift
 * into: whichever scanner runs, the lines tested are the lines of the files in
 * `files`, and a caller that gets a result cannot tell which one produced it.
 *
 * Everything is synchronous on purpose. These are short-lived pre-PR scripts
 * and an `await` in the middle would buy nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * ripgrep's exit codes. 1 is the deliberate "nothing matched"; anything else is
 * ripgrep reporting a problem of its own, and is never a pass.
 */
const RG_NO_MATCHES = 1;

/**
 * What `cmd.exe` says when the command does not exist. Windows has no `execvp`,
 * so a missing `rg` is a shell error (`… is not recognized …`, exit 1) rather
 * than the 127 a POSIX shell produces — which is the whole reason exit 1 could
 * not be trusted here.
 */
const SHELL_MISSING_COMMAND = /is not recognized|command not found|not recognized as an internal/i;

/** Set on the first genuine "ripgrep is not available" and reused after that. */
let ripgrepMissing = null;

const missingRipgrep = (detail) => {
  ripgrepMissing ??= detail;
  return ripgrepMissing;
};

/** True once ripgrep has been tried and found unusable in this process. */
export function ripgrepUnavailable() {
  return ripgrepMissing;
}

/**
 * Translate a ripgrep `--glob` into a regex.
 *
 * Only the shapes these gates actually use are supported, and anything else
 * throws rather than approximating. A silently different file set between the
 * two scanners is the bug this module exists to prevent, so an unsupported glob
 * is a reason to add it here deliberately, not to guess.
 *
 *   `**` crosses directories, `*` and `?` do not, `{a,b}` alternates.
 *
 * Whether the pattern is then matched against the whole POSIX-relative path or
 * only the basename is `selectFiles`'s decision, because that is ripgrep's rule
 * for the argument rather than a property of the glob syntax.
 */
export function globToRegExp(glob) {
  const LITERAL = /[.*+?^$()|[\]\\]/;
  let pattern = "^";

  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];

    if (glob.startsWith("**/", i)) {
      pattern += "(?:[^/]+/)*";
      i += 2;
      continue;
    }
    if (glob.startsWith("**", i)) {
      pattern += ".*";
      i += 1;
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    if (char === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) throw new Error(`unbalanced brace in glob: ${glob}`);
      pattern += `(?:${glob
        .slice(i + 1, close)
        .split(",")
        .map((part) => part.replace(LITERAL, "\\$&"))
        .join("|")})`;
      i = close;
      continue;
    }
    pattern += LITERAL.test(char) ? `\\${char}` : char;
  }

  return new RegExp(`${pattern}$`);
}

/**
 * A pattern both scanners accept, or an error.
 *
 * The gates pass grep-flavoured patterns, and Node's regex engine is a superset
 * of ripgrep's — `\w`, `\d`, groups, alternation and `.` all mean the same
 * thing. The constructs that differ are the ones that would make the two
 * scanners disagree, so they are refused before either runs. Checking here, in
 * the one place both paths go through, is what keeps them agreeing: a pattern
 * refused only on the Node path would work on a machine with ripgrep and throw
 * on a machine without, which is the drift this module exists to prevent. If a
 * rule ever needs one of these constructs, teach the fallback first.
 */
const NODE_ONLY_SYNTAX = /\(\?[=!<]|\\[1-9]|\(\?<|\\k</;

function assertPortablePattern(pattern) {
  if (NODE_ONLY_SYNTAX.test(pattern)) {
    throw new Error(
      `pattern uses a construct ripgrep and Node would read differently: ${pattern}\n` +
        "      keep gate patterns to literals, character classes, groups and alternation",
    );
  }
  return pattern;
}

/**
 * Paths to search, in the order given, filtered by an optional glob.
 *
 * The basename rule lives here rather than in `globToRegExp` because it is what
 * ripgrep does with the argument, not a property of the glob syntax: a glob with
 * no slash in it is a basename pattern.
 */
export function selectFiles(files, glob) {
  if (!glob) return files;
  const match = globToRegExp(glob);
  const basenameOnly = !glob.includes("/");
  return files.filter((file) => match.test(basenameOnly ? file.slice(file.lastIndexOf("/") + 1) : file));
}

/**
 * `file:line:text`, the shape both gates parse, for every matching line.
 *
 * Reads are decoded as UTF-8 from an absolute path derived from `root`, and a
 * file that cannot be read is an error rather than a skip: a gate that cannot
 * see a file has not checked it, and reporting that as a pass is the failure
 * mode with the longest history in this directory.
 *
 * Line endings are normalised away before the match. ripgrep strips a trailing
 * carriage return from the line it prints and a plain `split("\n")` does not, so
 * leaving it would make the two scanners print different text for the same
 * match — which is the kind of difference this module exists to not have.
 */
function nodeLines(root, files, pattern) {
  const regex = new RegExp(pattern);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].replace(/\r$/, "");
      if (regex.test(line)) hits.push(`${file}:${i + 1}:${line}`);
    }
  }
  return hits;
}

/**
 * How many paths to hand ripgrep in one invocation.
 *
 * ripgrep takes the files to search as positional arguments — it has no
 * "read the list from stdin" option, and an earlier revision of this file
 * invented one (`--files-from`) that does not exist, which made `check:solid`
 * die with `unrecognized flag` the first time it ran against a real ripgrep.
 * Positional arguments are therefore the only option, and they are bounded:
 * a command line has a hard length limit (`CreateProcess` allows about 32k
 * characters on Windows, more on Linux), and this repository already has
 * hundreds of files under `apps/web/src/features`. Batching keeps each call
 * well inside that limit at any repository size, and the results are
 * concatenated in file order so the output is identical to one call.
 */
const RG_BATCH = 100;

/**
 * The same match, through ripgrep, over exactly `files`.
 *
 * Returns `null` when ripgrep cannot be used, which is the signal to run
 * `nodeLines` instead.
 */
function ripgrepLines(root, files, pattern) {
  if (ripgrepMissing) return null;
  if (files.length === 0) return [];

  const hits = [];
  for (let start = 0; start < files.length; start += RG_BATCH) {
    const batch = files.slice(start, start + RG_BATCH);
    const result = spawnSync(
      "rg",
      ["--no-config", "-n", "--no-heading", "-e", pattern, "--", ...batch],
      { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 },
    );

    if (result.error) {
      // ENOENT with a binary name, or the platform refusing the spawn outright.
      missingRipgrep(`ripgrep could not be started (${result.error.code ?? result.error.message})`);
      return null;
    }

    if (result.status === 0) {
      hits.push(...result.stdout.split(/\r?\n/).filter(Boolean));
      continue;
    }

    if (result.status === RG_NO_MATCHES) {
      // Exit 1 is "nothing matched" from ripgrep — but it is also what `cmd.exe`
      // reports for a command that does not exist, which is how the gates failed
      // open on Windows. Only the message tells them apart, so it is read.
      if (SHELL_MISSING_COMMAND.test(result.stderr ?? "")) {
        missingRipgrep("ripgrep is not installed");
        return null;
      }
      continue;
    }

    // Any other code is ripgrep complaining about something that is not a match.
    // A malformed pattern must not read as "no violations".
    throw new Error(`ripgrep exited ${result.status}: ${(result.stderr ?? "").trim() || "no message"}`);
  }

  return hits;
}

/**
 * Lines matching `pattern` in `files`, under `root`.
 *
 * `files` are POSIX-relative to `root`. Returns `file:line:text`.
 */
export function searchLines({ root, files, pattern, glob }) {
  assertPortablePattern(pattern);
  const selected = selectFiles(files, glob);
  const fromRipgrep = ripgrepLines(root, selected, pattern);
  return fromRipgrep ?? nodeLines(root, selected, pattern);
}

/** A one-line note for the gate to print, so "which scanner ran" is never a guess. */
export function searchedWith() {
  return ripgrepMissing ? `Node (${ripgrepMissing})` : "ripgrep";
}

/**
 * Files git is tracking under `paths`, POSIX-separated.
 *
 * The candidate list is git's, not the filesystem's, so a gate sees the same
 * files in CI as it does on a laptop: a build directory, a scratch script, and
 * a file that is `.gitignore`d for good reason are all absent, and an untracked
 * one is too. That matters more for a rule that walks a directory tree than for
 * one that greps a named file — `apps/web/src` holds `.next` and `node_modules`
 * on a working checkout.
 *
 * Removal is deliberately not attempted here. `git rm` in the same commit as an
 * edit is uncommon and the stale entry is inert because the loop below drops
 * paths that are no longer on disk. (The equivalent filter in
 * `check-hygiene.mjs` does it inside its own `tracked()`; both are correct, and
 * neither is worth a shared abstraction.)
 *
 * A missing git is an error, not an empty list. Producing no candidates would
 * make every rule pass, which is the failure this whole module exists to
 * prevent.
 */
export function trackedFiles(root, paths) {
  const quoted = paths.map((value) => `"${value}"`).join(" ");
  const result = spawnSync(`git ls-files ${quoted}`, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    maxBuffer: 1 << 28,
  });

  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr ?? "").trim() ?? `exit ${result.status}`;
    throw new Error(
      `git ls-files failed: ${detail}\n` +
        "      the boundary gates need git to know which files are tracked; run them inside the checkout",
    );
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => existsSync(path.join(root, file)));
}
