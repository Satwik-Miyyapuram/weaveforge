#!/usr/bin/env bash
#
# Developer Certificate of Origin: every commit a pull request adds must carry a
# Signed-off-by line for its own author.
#
# CONTRIBUTING.md has asked for this since the beginning and nothing checked it,
# so nothing did it — the rule was false for the whole of the history before this
# script. It therefore looks only at the commits a pull request adds, never at
# what is already on main.
#
# Usage: check-dco.sh <base-sha> <head-sha>
set -euo pipefail

base="${1:?base sha}"
head="${2:?head sha}"

failed=0
while read -r sha; do
  [ -n "$sha" ] || continue

  # Merge commits are not anybody's contribution — they carry no new work of
  # their own, and a branch updated from main through the GitHub UI produces one
  # that no contributor could have signed.
  if [ "$(git rev-list --parents -n 1 "$sha" | wc -w)" -gt 2 ]; then
    continue
  fi

  author="$(git show -s --format='%ae' "$sha")"
  subject="$(git show -s --format='%s' "$sha")"

  # The trailer has to name the author. A sign-off is a statement about who has
  # the right to submit the work, so one carrying somebody else's address
  # certifies nothing about the person who wrote it.
  # -F on the address: an email is not a pattern, and a `+` in a Gmail-style
  # address would otherwise be read as a repetition operator.
  if git show -s --format='%B' "$sha" | grep -i '^Signed-off-by:' | grep -qF "<${author}>"; then
    continue
  fi

  echo "FAIL ${sha:0:8} ${subject}"
  echo "     no 'Signed-off-by:' line for its author <${author}>"
  failed=1
done < <(git rev-list "${base}..${head}")

if [ "$failed" -ne 0 ]; then
  cat <<'EOF'

Sign off the commits above, then force-push the branch:

  git rebase --signoff origin/main

New commits: `git commit -s`. See CONTRIBUTING.md § Developer Certificate of
Origin for what the sign-off certifies.
EOF
  exit 1
fi

echo "check:dco passed"
