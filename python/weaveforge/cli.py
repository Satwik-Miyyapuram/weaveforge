"""``weaveforge`` command-line interface.

A thin presentation layer over the SDK (SRP): it parses args and calls the same
``connect`` / ``track`` the library exposes — no business logic of its own.

    weaveforge list [--project NAME]
    weaveforge import-tb  <logdir>          [--name N] [--project P]
    weaveforge import-wandb <entity/proj/id> [--name N] [--project P]
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from . import __version__


def _cmd_list(args: argparse.Namespace) -> int:
    from .container import connect

    c = connect(project=args.project)
    rows = c.experiments.list()
    if not rows:
        print("No experiments.")
        return 0
    for e in rows:
        metrics = ", ".join(f"{k}={v}" for k, v in list(e.metrics.items())[:4])
        print(f"{e.status:<9} {e.name}" + (f"  [{metrics}]" if metrics else ""))
    return 0


def _import(source_id: str, ref: str, args: argparse.Namespace) -> int:
    from .tracking import track

    name = args.name or f"{source_id} import"
    with track(name, sync={source_id: ref}, project=args.project) as run:
        print(f"Imported {source_id} '{ref}' into experiment {run.id}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="weaveforge", description=__doc__)
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="list experiments")
    p_list.add_argument("--project", help="project name to scope to")
    p_list.set_defaults(func=_cmd_list)

    p_tb = sub.add_parser("import-tb", help="import TensorBoard scalars")
    p_tb.add_argument("logdir")
    p_tb.add_argument("--name")
    p_tb.add_argument("--project")
    p_tb.set_defaults(func=lambda a: _import("tensorboard", a.logdir, a))

    p_wb = sub.add_parser("import-wandb", help="import a wandb run")
    p_wb.add_argument("run_path", help="entity/project/run_id")
    p_wb.add_argument("--name")
    p_wb.add_argument("--project")
    p_wb.set_defaults(func=lambda a: _import("wandb", a.run_path, a))

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
