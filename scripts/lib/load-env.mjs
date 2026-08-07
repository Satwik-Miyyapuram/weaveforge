/**
 * Load `.env.migration` from the repo root into `process.env`.
 *
 * Every migration script calls this, so that `npm run migrate:preflight` and
 * `npm run migrate` see the same values without a `set -a && source …` step
 * in front of them — a step that does not exist in PowerShell or cmd, which is
 * where most of these runs actually happen.
 *
 * Variables already present in the environment win, so a deliberate
 * `DATABASE_URL=… npm run migrate:ping` still overrides the file.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * @param {string} root Repository root.
 * @returns {boolean} Whether a file was found and read.
 */
export function loadMigrationEnv(root) {
  // `secrets/` first, repo root second. Everything credential-shaped now lives
  // in the ignored `secrets/` directory; the root path stays supported so a
  // checkout that predates the move keeps working rather than failing with a
  // message about an unset variable.
  const path = [join(root, "secrets", ".env.migration"), join(root, ".env.migration")].find(
    (candidate) => existsSync(candidate),
  );
  if (!path) return false;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = LINE.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    // Strip one layer of matching quotes and nothing else: a connection string
    // may legitimately contain almost any character, and guessing at escapes
    // would corrupt passwords rather than help.
    process.env[key] = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
  }
  return true;
}
