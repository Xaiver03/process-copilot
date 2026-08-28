"""Small single-process worker entry point for processed demo artifacts.

The first demo has no external queue: API writes durable state and this process
is intentionally read-only. The entry point is kept stable for Compose so a
future replay executor can be added without changing the deployment command.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from sqlalchemy import select

from .catalog import DataCatalog
from .db import Database, ReplayRunRow, RunInferenceStateRow
from .replay_executor import ReplayExecutor

logger = logging.getLogger(__name__)


def _default_data_dir() -> Path:
    configured = os.getenv("DEMO_DATA_DIR")
    if configured:
        return Path(configured)
    return Path("/app/data/processed")


def _default_database_url() -> str:
    configured = os.getenv("DATABASE_URL")
    if configured:
        return configured
    return "sqlite:////app/data/process_copilot.db"


def inspect_processed_data(data_dir: str | Path | None = None) -> dict[str, Any]:
    """Return a read-only snapshot of the scenario/model inputs for the worker."""

    root = Path(data_dir or _default_data_dir())
    catalog = DataCatalog(root)
    model_candidates = [root / "models"]
    configured_model_dir = os.getenv("MODEL_ARTIFACT_DIR")
    if configured_model_dir:
        model_candidates.append(Path(configured_model_dir))
    model_dir = next(
        (candidate for candidate in model_candidates if candidate.is_dir()),
        model_candidates[0],
    )
    model_ready = (model_dir / "model_manifest.json").is_file()
    catalog_status, catalog_message = catalog.readiness()
    status = "ok" if catalog_status == "ok" and model_ready else "degraded"
    return {
        "status": status,
        "dataDir": str(root),
        "modelDir": str(model_dir),
        "scenarioCount": len(catalog.scenarios),
        "modelReady": model_ready,
        "message": catalog_message if not model_ready else "processed inputs available",
    }


def execute_playing_runs(executor: ReplayExecutor) -> int:
    """Advance every durable online run currently marked ``playing`` once."""

    with executor.database.session() as session:
        run_ids = list(
            session.scalars(
                select(ReplayRunRow.id)
                .join(RunInferenceStateRow, RunInferenceStateRow.run_id == ReplayRunRow.id)
                .where(ReplayRunRow.state == "playing", RunInferenceStateRow.mode == "online")
            )
        )
    for run_id in run_ids:
        executor.tick(run_id)
    return len(run_ids)


def run_worker_once(
    database_url: str | None = None,
    data_dir: str | Path | None = None,
    worker_id: str = "worker",
) -> int:
    """Create an executor, process current playing runs, and return its count."""

    database = Database(database_url or _default_database_url())
    database.create_schema()
    executor = ReplayExecutor(database, data_dir or _default_data_dir(), worker_id=worker_id)
    return execute_playing_runs(executor)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Process Copilot read-only artifact worker")
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--once", action="store_true", help="inspect inputs once and exit")
    args = parser.parse_args(argv)

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    database = Database(args.database_url or _default_database_url())
    database.create_schema()
    executor = ReplayExecutor(
        database,
        args.data_dir or _default_data_dir(),
        worker_id=os.getenv("WORKER_ID", "worker"),
    )
    while True:
        run_count = execute_playing_runs(executor)
        snapshot = inspect_processed_data(args.data_dir)
        snapshot["runsAdvanced"] = run_count
        logger.info("worker inputs: %s", json.dumps(snapshot, ensure_ascii=False))
        if args.once:
            print(json.dumps(snapshot, ensure_ascii=False))
            return 0
        time.sleep(max(args.interval, 0.1))


if __name__ == "__main__":
    raise SystemExit(main())
