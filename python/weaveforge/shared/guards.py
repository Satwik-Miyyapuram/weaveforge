"""Steps whose failure must be reported, never raised.

The SDK ends a run over a network that has usually just gone away — that is
often *why* the training stopped — so the last few operations are best-effort by
policy: warn, keep going, and let whatever the caller was already carrying stay
the error they see. Three hand-rolled copies of that policy lived in
``tracking`` and a fourth in ``run``; written per call site, it was applied
wherever the author remembered it, and the one place that needed it most (the
success path) had none.

Putting it in one function also makes "did this step fail?" answerable, which
the finaliser needs: it has to know whether the send failed before it decides
whether to re-raise, and a bare ``try/except`` cannot tell it.
"""

from __future__ import annotations

import warnings
from collections.abc import Callable
from typing import Any

#: The frame a warning should point at. Three frames sit between the user's
#: ``with track(...)`` line and this module — ``track``, the helper that owns the
#: policy, and :func:`best_effort` itself — so a caller at that depth wants 4.
#: Callers reachable through a different depth pass their own.
USER_FRAME = 4


def best_effort(
    what: str,
    action: Callable[[], Any],
    *,
    stacklevel: int = USER_FRAME,
) -> Exception | None:
    """Run ``action``; on failure warn and return the exception.

    Returns ``None`` when the step succeeded, so a caller can chain several and
    keep the first failure to re-raise later without masking it.
    """
    try:
        action()
    except Exception as exc:  # noqa: BLE001 - absorbing the failure is the point
        warnings.warn(f"weaveforge: could not {what} ({exc})", stacklevel=stacklevel)
        return exc
    return None
