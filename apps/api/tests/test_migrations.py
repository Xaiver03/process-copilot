from __future__ import annotations

import pytest
from process_copilot_api.db import (
    AnomalyEventRow,
    Database,
    IdempotencyRow,
    column_names,
    table_names,
)
from process_copilot_api.migrations import upgrade_database
from sqlalchemy import text


def test_upgrade_head_builds_fresh_sqlite_schema(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'migrated.db'}"

    upgrade_database(database_url)

    database = Database(database_url)
    database.check_ready()
    tables = table_names(database.engine)
    expected_tables = {
        "admin_audit_events",
        "ai_configurations",
        "ai_interactions",
        "ai_runtime_probes",
        "operators",
        "decision_records",
        "control_proposals",
        "replay_runs",
        "run_inference_state",
        "run_stream_messages",
        "anomaly_events",
        "audit_events",
        "audits",
        "idempotency_records",
    }
    assert expected_tables.issubset(tables)
    assert "operator_role" in column_names(database.engine, "decision_records")

    with database.session() as session:
        session.add(
            AnomalyEventRow(
                id="event-after-migration",
                run_id="run-after-migration",
                sample_index=160,
                severity="warning",
                state="open",
                anomaly_score=0.8,
                detail={},
            )
        )
        session.add(
            IdempotencyRow(
                id="migration:request-1",
                fingerprint="0" * 64,
                response={},
                status_code=201,
            )
        )


def test_upgrade_head_backfills_existing_schema(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'legacy.db'}"

    database = Database(database_url)
    database.create_schema()
    with database.engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE decision_records DROP COLUMN operator_role")
        connection.exec_driver_sql("CREATE TABLE legacy_marker (id INTEGER PRIMARY KEY)")

    upgrade_database(database_url)

    assert "operator_role" in column_names(database.engine, "decision_records")
    assert "legacy_marker" in table_names(database.engine)


def test_upgrade_head_reconciles_legacy_timestamp_columns(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'legacy-timestamps.db'}"

    database = Database(database_url)
    database.create_schema()
    with database.engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE anomaly_events DROP COLUMN created_at")
        connection.exec_driver_sql("ALTER TABLE idempotency_records DROP COLUMN created_at")
        connection.execute(
            text(
                """
                INSERT INTO anomaly_events (
                    id, run_id, sample_index, severity, state, anomaly_score, detail
                ) VALUES (
                    'legacy-event', 'legacy-run', 12, 'warning', 'open', 0.7, '{}'
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO idempotency_records (
                    id, fingerprint, response, status_code
                ) VALUES (
                    'legacy:request-1', :fingerprint, '{}', 201
                )
                """
            ),
            {"fingerprint": "0" * 64},
        )

    upgrade_database(database_url)

    assert "created_at" in column_names(database.engine, "anomaly_events")
    assert "created_at" in column_names(database.engine, "idempotency_records")
    with database.engine.connect() as connection:
        assert connection.scalar(
            text("SELECT created_at FROM anomaly_events WHERE id = 'legacy-event'")
        )
        assert connection.scalar(
            text(
                "SELECT created_at FROM idempotency_records "
                "WHERE id = 'legacy:request-1'"
            )
        )


def test_upgrade_rejects_partial_online_runtime_schema(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'partial-runtime.db'}"
    database = Database(database_url)
    database.create_schema()
    with database.engine.begin() as connection:
        connection.execute(text("ALTER TABLE run_stream_messages DROP COLUMN payload"))

    with pytest.raises(RuntimeError, match="run_stream_messages.*payload"):
        upgrade_database(database_url)
