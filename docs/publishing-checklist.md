# Publishing checklist — private repo → public AGPL repo

Run through this once, before the first public push.

## 1. Licence state (done)

- [x] `LICENSE` — AGPL-3.0-only, verbatim from gnu.org
- [x] `python/LICENSE`, `plugins/weaveforge-research/LICENSE` — AGPL-3.0-only
- [x] `package.json` × 3 → `AGPL-3.0-only`
- [x] `python/pyproject.toml` → `AGPL-3.0-only` + AGPL trove classifier
- [x] `plugins/weaveforge-research/.codex-plugin/plugin.json` → `AGPL-3.0-only`
- [x] `NOTICE`, `CONTRIBUTORS.md`, `CONTRIBUTING.md`
- [x] README badge and licence section
- [x] No permissive carve-outs anywhere

## 2. Do NOT copy these directories

They are gitignored, so `git add .` will not stage them — but a **folder copy carries them physically**. Delete them from the copy, or copy selectively.

| Path | Why | Size |
|------|-----|------|
| `local-dev/` | **Contains `test-accounts.env` with real test credentials** | 44K |
| `backups/` | Database/content backups | 296K |
| `.conda-plugin-tools/` | Vendored toolchain, not project source | 166M |
| `graphify-out/` | Build artifacts | 16M |
| `test-results/` | Playwright output | 1K |
| `node_modules/`, `.next/` | Regenerable | large |

Clean copy on Windows (PowerShell), excluding the above and the old git history:

```bash
robocopy . ..\weaveforge-public /E /XD .git node_modules .next local-dev backups graphify-out test-results .conda-plugin-tools /XF .env .env.local
```

Then in the new folder: `git init`, `git add .`, and make the first commit with the AGPL `LICENSE` already in place — so provenance is unambiguous from commit one, exactly as it was in the private repo.

## 3. Before pushing

- [ ] `git status` in the new repo — confirm no `.env`, no `local-dev/`, no `backups/`
- [ ] Run a real secret scanner over the working tree: `gitleaks detect --no-git`
      (a pattern grep for API keys, JWTs, and private keys found nothing, but that is
      not a substitute)
- [ ] Confirm `.gitignore` came across
- [ ] `npm install && npm run build` in the fresh copy — catch anything that was
      only working because of untracked local state
- [ ] Set the GitHub repo licence field to AGPL-3.0 so the sidebar shows it
- [ ] Enable branch protection and require DCO sign-off (`CONTRIBUTING.md` mandates `git commit -s`)

## 4. Keep the private repo

Archive it, do not delete. It is the dated record of what you wrote and when — the evidence of authorship if it is ever questioned. It costs nothing to keep.

## 5. After publishing

- [ ] Claim `weaveforge` on npm and PyPI — both free as of 2026-07-25. The name
      decision stands: no trademark is being registered
- [ ] Add a CI licence-compatibility check for dependencies
- [ ] Consider SPDX headers (`SPDX-License-Identifier: AGPL-3.0-only`) on new source files —
      recommended, not required; the repo-wide `LICENSE` governs regardless
