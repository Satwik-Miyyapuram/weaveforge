# Releasing the Python SDK

GitHub **tags and releases** in this repo are for the **`thesis-tracker` PyPI package** (`python/`). The web app does not have its own semver or PyPI artifact — it ships continuously on `main` and is **self-hosted** by each installation.

## Two products, one repo

| | **Python SDK** | **Web app** |
|---|----------------|-------------|
| Version | `python/thesis_tracker/__init__.py` | Not versioned for users (`apps/web` stays `0.1.0`) |
| Install | `pip install thesis-tracker` | Clone repo + `npm ci && npm run build:core && npm run build --workspace @thesis/web` |
| Release trigger | Git tag `vX.Y.Z` + GitHub Release → PyPI | Merge to `main` (+ run DB migrations on your Supabase) |
| Automated publish | `.github/workflows/publish-python.yml` | None (no Vercel/Cloudflare workflow in this repo) |

The SDK talks to whatever instance you run at `THESIS_TRACKER_API_URL` (local dev, your VM, etc.).

## Python release checklist

1. **Branch from `main`** — all releases land via pull request (see [CONTRIBUTING.md](CONTRIBUTING.md)).
2. **Bump version** in `python/thesis_tracker/__init__.py` (semver).
3. **Update `CHANGELOG.md`** — add a `[X.Y.Z]` section with **Python SDK** changes only (use `### Changed`, `### Fixed`, `### Added` under that version).
4. **Open PR** → wait for CI (`build-and-test`, `python-sdk`) → merge.
5. **Tag and release** on `main`:
   ```bash
   git pull origin main
   git tag vX.Y.Z
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file .github/release_template.md
   ```
   Edit the release notes in the GitHub UI: keep the `pip install` line and Python bullets; remove the HTML comment block.
6. **PyPI** — publishing runs automatically when the release is **published** (workflow `publish-python.yml`). Check [Actions](https://github.com/Satwik-Miyyapuram/thesis_tracker/actions/workflows/publish-python.yml) and https://pypi.org/project/thesis-tracker/ .

> **Do not re-use a PyPI version.** If `1.0.4` is already on PyPI, bump to `1.0.5`.

### Manual PyPI publish (fallback)

```bash
gh workflow run publish-python.yml
```

Only if the release workflow failed; fix the version conflict first.

## Web app changes

- Merge feature PRs to **`main`** — no Git tag required.
- Document **breaking** web/schema changes in `supabase/migrations/README.md` and `docs/dev.md`.
- Optional: note large web features under `CHANGELOG.md` → `[Unreleased]` → **Web** subsection (not tied to PyPI version).

Self-hosters update by pulling `main` (or a tag for convenience), running new migrations, and rebuilding:

```bash
git pull origin main
supabase db push   # or apply new SQL files
npm ci && npm run build:core && npm run build --workspace @thesis/web
```

## Version tags

| Tag | Meaning |
|-----|---------|
| `v1.0.4` | Python SDK `1.0.4` on PyPI |
| `main` | Latest web + SDK source; web installs track this |

Older tags may point at monorepo snapshots; **PyPI version** is always `python/thesis_tracker/__init__.py` at that tag.
