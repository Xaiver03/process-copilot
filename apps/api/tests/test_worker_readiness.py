from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from process_copilot_api.db import Database, ReplayRunRow, RunInferenceStateRow
from process_copilot_api.main import create_app
from process_copilot_api.worker import check_worker, main


class ReadyEngine:
    model_version = "ready-v1"


def _database_with_online_run(tmp_path: Path, *, heartbeat: datetime | None) -> str:
    database_url = f"sqlite:///{tmp_path / 'ready.db'}"
    database = Database(database_url)
    database.create_schema()
    now = datetime.now(UTC).replace(tzinfo=None)
    run_id = str(uuid4())
    with database.session() as session:
        session.add(
            ReplayRunRow(
                id=run_id,
                scenario_id="tep-test",
                state="playing",
                speed=1,
                current_sample=0,
                created_at=now,
            )
        )
        session.add(
            RunInferenceStateRow(
                run_id=run_id,
                mode="online",
                model_version="ready-v1",
                worker_id="worker-test" if heartbeat else None,
                heartbeat_at=heartbeat,
                failure_reason="secret internal failure" if heartbeat is None else None,
            )
        )
    return database_url


def test_check_worker_allows_ready_model_without_online_run(tmp_path: Path, monkeypatch) -> None:
    database_url = f"sqlite:///{tmp_path / 'ready.db'}"
    database = Database(database_url)
    database.create_schema()
    monkeypatch.setattr(
        "process_copilot_api.worker.OnlineInferenceEngine.from_artifacts",
        lambda model_dir, variable_dictionary_path: ReadyEngine(),
    )

    result = check_worker(database_url, tmp_path)

    assert result["status"] == "ok"
    assert result["checks"] == {
        "database": "available",
        "industrial_model": "available",
        "worker_heartbeat": "not_required",
    }


def test_check_worker_rejects_missing_or_stale_playing_heartbeat(
    tmp_path: Path, monkeypatch
) -> None:
    stale = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=61)
    database_url = _database_with_online_run(tmp_path, heartbeat=stale)
    monkeypatch.setattr(
        "process_copilot_api.worker.OnlineInferenceEngine.from_artifacts",
        lambda model_dir, variable_dictionary_path: ReadyEngine(),
    )

    stale_result = check_worker(database_url, tmp_path, heartbeat_timeout_seconds=60)
    assert stale_result["status"] == "degraded"
    assert stale_result["checks"]["worker_heartbeat"] == "stale"
    assert "secret internal failure" not in json.dumps(stale_result)

    missing_url = _database_with_online_run(tmp_path / "missing", heartbeat=None)
    missing_result = check_worker(missing_url, tmp_path / "missing")
    assert missing_result["status"] == "degraded"
    assert missing_result["checks"]["worker_heartbeat"] == "missing"
    assert "secret internal failure" not in json.dumps(missing_result)


def test_worker_check_flag_emits_safe_json_and_exit_code(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    monkeypatch.setattr(
        "process_copilot_api.worker.check_worker",
        lambda *args, **kwargs: {
            "status": "degraded",
            "checks": {
                "database": "available",
                "industrial_model": "unavailable",
                "worker_heartbeat": "not_required",
            },
        },
    )

    exit_code = main(["--check", "--data-dir", str(tmp_path)])

    assert exit_code == 1
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "degraded"
    assert "failure_reason" not in output


def test_readyz_exposes_worker_and_model_gates_without_internal_reason(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_dir=tmp_path / "missing-data",
    )
    with TestClient(app) as client:
        response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["checks"]["industrial_model"] == "unavailable"
    assert response.json()["checks"]["worker"] == "not_required"
