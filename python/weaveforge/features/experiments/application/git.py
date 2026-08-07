"""Best-effort capture of the local git state, so a run is automatically pinned
to a repo / branch / commit (the whole point of the experiments feature). Never
raises: outside a repo, or with git absent, every field is just ``None``.
"""

from __future__ import annotations

import subprocess


def _git(*args: str, cwd: str | None = None) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        return out.stdout.strip() or None
    except (subprocess.SubprocessError, OSError):
        return None


def _normalize_remote(url: str | None) -> str | None:
    """Turn an ssh/`.git` remote into a browsable https URL (matches the web
    app's commit-link expectations)."""
    if not url:
        return None
    url = url.strip()
    if url.startswith("git@") and ":" in url:
        host, path = url[4:].split(":", 1)
        url = f"https://{host}/{path}"
    if url.endswith(".git"):
        url = url[:-4]
    return url


def capture_git_state(cwd: str | None = None) -> dict[str, str | None]:
    branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=cwd)
    return {
        "repo_url": _normalize_remote(_git("config", "--get", "remote.origin.url", cwd=cwd)),
        "commit_sha": _git("rev-parse", "HEAD", cwd=cwd),
        "branch": None if branch == "HEAD" else branch,
    }
