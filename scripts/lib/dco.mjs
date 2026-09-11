/**
 * The parts of the DCO check that are decisions rather than git calls.
 *
 * Separated so they can be exercised without a repository, because a sign-off
 * rule that is subtly wrong is worse than no rule: it certifies work nobody
 * certified, or rejects a branch that did everything right. `check-dco.mjs`
 * makes the git calls and this decides; `scripts/check-dco.sh` is the shell
 * twin of both, and the CI job runs the two so they cannot drift apart.
 */

/**
 * A merge commit, as `git rev-list --parents -n 1 | wc -w` sees it.
 *
 * The shell counts the commit itself among the words, so "more than 2" is "more
 * than one parent". Merge commits are not anybody's contribution: they carry no
 * new work of their own, and a branch updated from main through the GitHub UI
 * produces one no contributor could have signed.
 */
export function isMergeCommit(parentLine) {
  const parents = parentLine.trim();
  return parents ? parents.split(/\s+/).length > 1 : false;
}

/**
 * Whether the commit was written by a bot rather than a person.
 *
 * A sign-off certifies that *the author* has the right to submit the work, so a
 * commit no person authored has nothing to certify and nothing that could
 * certify it. Dependabot cannot add a trailer, and the `dco` job is a required
 * check — without this exemption every dependency PR would be permanently
 * blocked, and the usual way out of that is to stop running the check at all.
 *
 * Matched on GitHub's own convention rather than a hardcoded list of accounts:
 * every bot has an address of the form `<name>[bot]@users.noreply.github.com`,
 * so `dependabot`, `github-actions` and anything added later are covered by one
 * rule. A human cannot register an address containing `[bot]`, which is what
 * keeps this from becoming a way to opt out of signing off.
 */
export function isBotAuthor(author) {
  return /\[bot\]@/i.test(String(author));
}

/**
 * Whether the message carries a `Signed-off-by:` trailer for `author`.
 *
 * The trailer name is matched case-insensitively, as the shell's `grep -i` does.
 * The address is matched as a literal, because the shell uses `grep -qF` — an
 * email is not a pattern, and a `+` in a Gmail-style address would otherwise be
 * read as a repetition operator, so `someone+tag@example.com` would let a
 * sign-off for `someonetag@example.com` through.
 *
 * The whole trailer line is searched, not just the address: a sign-off has to
 * name the author, since one carrying somebody else's address certifies nothing
 * about the person who wrote the work.
 */
export function hasOwnSignOff(message, author) {
  const needle = `<${author}>`;
  return String(message)
    .split("\n")
    .some((line) => /^Signed-off-by:/i.test(line) && line.includes(needle));
}
