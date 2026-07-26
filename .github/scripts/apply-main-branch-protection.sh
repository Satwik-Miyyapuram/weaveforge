#!/usr/bin/env bash
# Apply GitHub branch protection on `main` (repo admin required).
# Usage: ./.github/scripts/apply-main-branch-protection.sh
#
# Requires: gh CLI authenticated with admin access to the repository.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${GITHUB_REPOSITORY:-Satwik-Miyyapuram/weaveforge}"
BRANCH="${1:-main}"

echo "Applying branch protection to ${REPO}@${BRANCH}..."

gh api \
  --method PUT \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --input "${SCRIPT_DIR}/../branch-protection.json"

echo "Done. Required checks before merge to ${BRANCH}:"
echo "  - build-and-test (core + web tests, typecheck, check:solid, lint, build)"
echo "  - python-sdk (ruff, mypy, pytest)"
echo "Pull requests required — direct pushes blocked (including admins)."
echo "Approving reviews: 0 (solo maintainer can merge own PR after CI passes)."
