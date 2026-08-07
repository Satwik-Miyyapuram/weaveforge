"""Uploads experiment artifacts (matplotlib figures, plots, small checkpoints)
to the private ``experiment-artifacts`` bucket (migration 0017) and returns a
link to store in ``experiments.artifacts``.

Files live at ``<user_id>/<experiment_id>/<name>`` so the per-user storage
policies scope them to the caller (mirrors the web app's paper-images store).
"""

from __future__ import annotations

from typing import Any

_BUCKET = "experiment-artifacts"
#: The bucket is private; we hand back a signed URL. Long-lived because a thesis
#: artifact link is meant to keep working. ~10 years in seconds.
_DEFAULT_EXPIRES = 10 * 365 * 24 * 3600


class SupabaseArtifactStorage:
    def __init__(self, client: Any, user_id: str, expires_in: int = _DEFAULT_EXPIRES) -> None:
        self._db = client
        self._user_id = user_id
        self._expires_in = expires_in

    def upload(
        self,
        experiment_id: str,
        name: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload bytes and return a signed URL to append to ``artifacts``."""
        path = f"{self._user_id}/{experiment_id}/{name}"
        bucket = self._db.storage.from_(_BUCKET)
        bucket.upload(
            path,
            data,
            {"content-type": content_type, "upsert": "true"},
        )
        signed = bucket.create_signed_url(path, self._expires_in)
        # storage3 returns {"signedURL": ..., "signedUrl": ...}; older builds
        # used {"signed_url": ...}. Fall back to the object path if none present.
        if isinstance(signed, dict):
            return (
                signed.get("signedURL")
                or signed.get("signedUrl")
                or signed.get("signed_url")
                or path
            )
        return str(signed) or path
