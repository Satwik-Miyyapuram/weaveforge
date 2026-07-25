"""Matplotlib figure source.

``run.log_figure(fig)`` already handles a single figure with no import; this
source adds ``run.sync("matplotlib", ref)`` to grab *all* currently-open pyplot
figures (``ref=None``) or specific ones, and compresses them to WebP (like the
web app does for paper images) when Pillow is available.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from typing import Any

from .registry import default_registry
from .source import Artifact, MissingDependencyError


def _render_figure(figure: Any, index: int, prefer_webp: bool = True) -> Artifact:
    """Pure: turn one ``savefig``-capable figure into an Artifact. Uses only the
    figure's own ``savefig`` (no matplotlib import), so it's unit-testable."""
    png = io.BytesIO()
    figure.savefig(png, format="png", bbox_inches="tight")
    data = png.getvalue()
    if prefer_webp:
        webp = _to_webp(data)
        if webp is not None:
            return Artifact(name=f"figure-{index}.webp", data=webp, content_type="image/webp")
    return Artifact(name=f"figure-{index}.png", data=data, content_type="image/png")


def _to_webp(png_bytes: bytes) -> bytes | None:
    try:
        from PIL import Image  # optional, via the [figures] extra
    except ImportError:
        return None
    out = io.BytesIO()
    with Image.open(io.BytesIO(png_bytes)) as img:
        img.save(out, format="WEBP", quality=90, method=6)
    return out.getvalue()


class MatplotlibSource:
    id = "matplotlib"

    def available(self) -> bool:
        try:
            import matplotlib  # noqa: F401
        except ImportError:
            return False
        return True

    def _resolve(self, ref: Any) -> list[Any]:
        if ref is None:
            try:
                import matplotlib.pyplot as plt
            except ImportError as exc:
                raise MissingDependencyError("matplotlib", "figures", "matplotlib") from exc
            return [plt.figure(num) for num in plt.get_fignums()]
        if hasattr(ref, "savefig"):
            return [ref]
        return list(ref)

    def collect(self, ref: Any = None) -> Iterator[Artifact]:
        for i, figure in enumerate(self._resolve(ref)):
            yield _render_figure(figure, i)


default_registry.register(MatplotlibSource(), replace=True)
