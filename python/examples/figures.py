"""Attach a matplotlib figure to a run.

    pip install 'weaveforge[figures]'
    python examples/figures.py

`run.log_figure(fig)` needs no matplotlib import in the SDK itself (it's
duck-typed on `savefig`); the [figures] extra adds WebP compression and the
`run.sync("matplotlib", None)` sweep of all open figures.
"""

import matplotlib

matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt  # noqa: E402

from weaveforge import track  # noqa: E402


def main():
    with track("figure demo", config={"kind": "reconstruction"}) as run:
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2, 3], [3, 1, 2, 0])
        ax.set_title("reconstruction error")
        url = run.log_figure(fig, name="recon")
        print("uploaded:", url)


if __name__ == "__main__":
    main()
