#!/usr/bin/env node
/**
 * Developer Certificate of Origin: every commit a pull request adds must carry a
 * Signed-off-by line for its own author.
 *
 *   node scripts/check-dco.mjs <base-sha> <head-sha>
 *
 * CONTRIBUTING.md has asked for this since the beginning and nothing checked it,
 * so nothing did it — the rule was false for the whole of the history before
 * this. It therefore looks only at the commits a pull request adds, never at
 * what is already on main.
 *
 * This is the same rule as scripts/check-dco.sh, in Node, because the shell
 * version cannot run on a Windows contributor's machine and the migrations
 * already set the precedent of a `.sh` for CI beside a `.mjs` for everyone. The
 * two are kept in step deliberately rather than by hope: this file is the one
 * that runs locally, and the CI job runs both, so a divergence fails the pull
 * request instead of quietly changing which sign-offs count.
 *
 * The matching mirrors the shell exactly:
 *
 *   - only `base..head`, per `git rev-list`;
 *   - merge commits skipped — they carry no new work of their own, and a branch
 *     updated through the GitHub UI produces one nobody could have signed;
 *   - a `Signed-off-by:` trailer, matched case-insensitively, that names the
 *     commit's own author address (`grep -qF "<author>"`: the address is a
 *     literal, not a pattern, so a `+` in a Gmail address is a `+`);
 *   - exit 1 with the same guidance.
 */
import { spawnSync } from "node:child_process";
import { hasOwnSignOff, isBotAuthor, isMergeCommit } from "./lib/dco.mjs";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  // Two arguments, not one, and not none: the rule is about the commits a branch
  // adds, and only the caller knows what it branched from. That is also why this
  // has no place in `check:boundaries` or `check:all` — both run with no
  // arguments, and a gate that cannot tell what to look at must not pass.
  console.error(
    "usage: node scripts/check-dco.mjs <base-sha> <head-sha>\n" +
      "\n" +
      "  npm run check:dco -- origin/main HEAD        # the branch's own commits\n" +
      "  npm run check:dco -- <base> <head>           # an explicit range\n" +
      "\n" +
      "  CI runs this with the pull request's base and head SHAs (see the `dco` job\n" +
      "  in .github/workflows/ci.yml), beside scripts/check-dco.sh, which is the same\n" +
      "  rule for the Linux runner.",
  );
  process.exit(2);
}

/**
 * Run git with inherited stdio disabled but output captured, and treat a
 * non-zero exit as a failure of the check rather than as "no commits" — the
 * whole point of this gate is that silence must not look like success.
 */
function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (result.error) {
    console.error(`check:dco could not run git: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0 && !allowFailure) {
    console.error(`check:dco: git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
    process.exit(2);
  }
  return result.stdout ?? "";
}

const commits = git(["rev-list", `${base}..${head}`])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

/**
 * The parents, author, subject and full message of one commit, `\0`-separated.
 *
 * Asked for in a single `git show` so the four cannot disagree about which
 * commit they describe.
 */
const failures = [];

for (const sha of commits) {
  const record = git(["show", "-s", "--format=%P%x00%ae%x00%s%x00%B", sha]);
  const [parents = "", author = "", subject = "", body = ""] = record.split("\0");

  if (isMergeCommit(parents)) continue;
  // A bot has no standing to certify anything, and Dependabot cannot write a
  // trailer at all — see `isBotAuthor` in lib/dco.mjs. Skipped rather than
  // failed, so this required check does not block every dependency PR.
  if (isBotAuthor(author)) continue;
  if (hasOwnSignOff(body, author)) continue;

  console.error(`FAIL ${sha.slice(0, 8)} ${subject}`);
  console.error(`     no 'Signed-off-by:' line for its author <${author}>`);
  failures.push(sha);
}

if (failures.length) {
  console.error(`
Sign off the commits above, then force-push the branch:

  git rebase --signoff origin/main

New commits: \`git commit -s\`. See CONTRIBUTING.md § Developer Certificate of
Origin for what the sign-off certifies.`);
  process.exit(1);
}

console.log(`check:dco passed (${commits.length} commit${commits.length === 1 ? "" : "s"} checked)`);
