"""CLI argument wiring (offline — no connect)."""

import pytest

from thesis_tracker.cli import build_parser


def test_list_parses():
    args = build_parser().parse_args(["list", "--project", "My Thesis"])
    assert args.command == "list" and args.project == "My Thesis"
    assert callable(args.func)


def test_import_tb_parses():
    args = build_parser().parse_args(["import-tb", "runs/x", "--name", "n"])
    assert args.logdir == "runs/x" and args.name == "n"


def test_import_wandb_parses():
    args = build_parser().parse_args(["import-wandb", "e/p/r"])
    assert args.run_path == "e/p/r"


def test_requires_subcommand():
    with pytest.raises(SystemExit):
        build_parser().parse_args([])
