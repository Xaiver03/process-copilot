from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from .db import Base

BASELINE_REVISION = "0001_initial"


def build_config(database_url: str | None = None) -> Config:
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url or os.environ["DATABASE_URL"])
    return config


def _needs_baseline_stamp(database_url: str) -> bool:
    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        if "alembic_version" in tables:
            return False
        return bool(tables.intersection(Base.metadata.tables))
    finally:
        engine.dispose()


def upgrade_database(database_url: str | None = None) -> None:
    url = database_url or os.environ["DATABASE_URL"]
    config = build_config(url)
    if _needs_baseline_stamp(url):
        command.stamp(config, BASELINE_REVISION)
    command.upgrade(config, "head")


if __name__ == "__main__":
    upgrade_database()
