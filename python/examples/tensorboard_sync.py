"""Import TensorBoard scalar curves into a run.

    pip install 'weaveforge[tensorboard]'
    python examples/tensorboard_sync.py /path/to/tb/logdir

`sync={"tensorboard": logdir}` pulls every scalar tag as a curve on exit; the
last value of each also lands in the summary chips.
"""

import sys

from weaveforge import track


def main(logdir: str):
    with track("tensorboard import", sync={"tensorboard": logdir}) as run:
        print("importing scalars from", logdir, "into experiment", run.id)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: python examples/tensorboard_sync.py <logdir>")
    main(sys.argv[1])
