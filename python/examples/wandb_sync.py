"""Import a Weights & Biases run's history + summary into a run, and link it.

    pip install 'thesis-tracker[wandb]'
    wandb login
    python examples/wandb_sync.py entity/project/run_id
"""

import sys

from thesis_tracker import track


def main(run_path: str):
    with track("wandb import", sync={"wandb": run_path}) as run:
        print("importing", run_path, "into experiment", run.id)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: python examples/wandb_sync.py <entity/project/run_id>")
    main(sys.argv[1])
