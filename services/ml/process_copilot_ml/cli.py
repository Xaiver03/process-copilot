from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from process_copilot_ml.build import build_demo


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _default_source_zip() -> Path:
    return (
        _project_root().parent
        / "02_AI与贵州特色产业数据研究"
        / "04_原始数据与资料"
        / "先进制造_开源基准数据_2026-08-28"
        / "raw"
        / "Tennessee_Eastman_Process_Braatz.zip"
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="process-copilot-ml")
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build-demo", help="Build deterministic TEP demo artifacts")
    build.add_argument("--source-zip", type=Path, default=_default_source_zip())
    build.add_argument("--output-dir", type=Path, default=_project_root() / "data" / "processed")
    build.add_argument("--manifest-dir", type=Path, default=_project_root() / "data" / "manifests")
    build.add_argument(
        "--force",
        action="store_true",
        help="replace non-empty formal output directories after staged validation",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "build-demo":
        result = build_demo(args.source_zip, args.output_dir, args.manifest_dir, force=args.force)
        print(f"buildHash={result.build_hash}")
        print(f"manifest={result.manifest_path}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
