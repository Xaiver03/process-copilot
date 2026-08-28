from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from process_copilot_api.db import (
    AnomalyEventRow,
    Database,
    ReplayRunRow,
    RunInferenceStateRow,
    RunStreamMessageRow,
)
from process_copilot_api.replay_executor import ReplayExecutor

RAW_COLUMNS = [
    *(f"XMEAS({index})" for index in range(1, 42)),
    *(f"XMV({index})" for index in range(1, 12)),
]


class FakeEngine:
    calls: list[int] = []
    fail = False

    def __init__(self, model_version: str = "fake-v1") -> None:
        self.model_version = model_version

    def process(self, *, sample_index: int, values: object) -> object:
        if self.fail:
            raise RuntimeError("inference failed")
        self.calls.append(sample_index)
        transition = {2: "detected", 4: "updated"}.get(sample_index)
        return SimpleNamespace(
            sample_index=sample_index,
            t2=float(sample_index),
            spe=float(sample_index) + 0.1,
            anomaly_score=2.0 if transition else 0.1,
            alarm_state="open" if transition else "normal",
            transition=transition,
            initial_candidates=((1, 0.8),) if transition == "detected" else None,
            updated_candidates=((6, 0.9),) if transition == "updated" else None,
            evidence=(
                {
                    "variableId": "XMEAS(1)",
                    "variableName": "flow",
                    "unit": "%",
                    "contribution": 0.8,
                    "direction": "up",
                },
            ),
            model_version=self.model_version,
            latency_ms=0.4,
        )


def _write_artifacts(root: Path, row_count: int = 6) -> None:
    scenario = root / "scenarios" / "tep-test"
    scenario.mkdir(parents=True)
    (scenario / "scenario.json").write_text(
        json.dumps(
            {
                "id": "tep-test",
                "name": "Test scenario",
                "faultId": 1,
                "sampleCount": row_count,
                "faultOnsetSample": 999,
                "sourceLabel": "Tennessee Eastman Process public simulation",
            }
        ),
        encoding="utf-8",
    )
    (root / "variable_dictionary.json").write_text(
        json.dumps(
            [
                {"variableId": name, "variableName": name, "unit": "u"}
                for name in RAW_COLUMNS
            ]
        ),
        encoding="utf-8",
    )
    models = root / "models"
    models.mkdir()
    (models / "model_manifest.json").write_text(
        json.dumps({"modelVersion": "fake-v1"}), encoding="utf-8"
    )
    columns = {name: [float(index) for index in range(row_count)] for name in RAW_COLUMNS}
    pq.write_table(pa.table(columns), scenario / "telemetry.parquet")


def _database_with_run(
    tmp_path: Path, *, state: str = "playing", speed: float = 5, current: int = 0
):
    database = Database(f"sqlite:///{tmp_path / 'worker.db'}")
    database.create_schema()
    run_id = str(uuid4())
    now = datetime.now(UTC).replace(tzinfo=None)
    with database.session() as session:
        session.add(
            ReplayRunRow(
                id=run_id,
                scenario_id="tep-test",
                state=state,
                speed=speed,
                current_sample=current,
                created_at=now,
            )
        )
        session.add(
            RunInferenceStateRow(
                run_id=run_id,
                mode="online",
                model_version="fake-v1",
                worker_id=None,
                heartbeat_at=None,
                failure_reason=None,
            )
        )
    return database, run_id


@pytest.fixture()
def fake_engine(monkeypatch):
    FakeEngine.calls = []
    FakeEngine.fail = False
    monkeypatch.setattr(
        "process_copilot_api.replay_executor.OnlineInferenceEngine.from_artifacts",
        lambda model_dir, variable_dictionary_path: FakeEngine(),
    )
    return FakeEngine


def test_tick_advances_only_playing_runs_and_caps_batch_at_20(tmp_path: Path, fake_engine) -> None:
    _write_artifacts(tmp_path, row_count=30)
    database, run_id = _database_with_run(tmp_path, speed=30, state="paused")
    executor = ReplayExecutor(database, tmp_path, worker_id="worker-test")

    assert executor.tick(run_id) is False
    with database.session() as session:
        run = session.get(ReplayRunRow, run_id)
        assert run.current_sample == 0
        run.state = "playing"

    assert executor.tick(run_id) is True
    with database.session() as session:
        run = session.get(ReplayRunRow, run_id)
        messages = session.query(RunStreamMessageRow).all()
        assert run.current_sample == 20
        inference_messages = [message for message in messages if message.event_type == "inference"]
        assert len(inference_messages) == 20
    assert fake_engine.calls == list(range(20))


def test_restart_clears_only_run_artifacts_and_rebuilds_from_zero(
    tmp_path: Path, fake_engine
) -> None:
    _write_artifacts(tmp_path)
    database, run_id = _database_with_run(tmp_path, state="paused", speed=1, current=4)
    other_run_id = str(uuid4())
    now = datetime.now(UTC).replace(tzinfo=None)
    with database.session() as session:
        session.add(
            RunStreamMessageRow(
                run_id=run_id, event_type="inference", sample_index=3, payload={}, created_at=now
            )
        )
        session.add(
            AnomalyEventRow(
                id=str(uuid4()),
                run_id=run_id,
                sample_index=2,
                severity="critical",
                state="open",
                anomaly_score=2.0,
                detail={},
            )
        )
        session.add(
            RunStreamMessageRow(
                run_id=other_run_id,
                event_type="inference",
                sample_index=3,
                payload={},
                created_at=now,
            )
        )

    executor = ReplayExecutor(database, tmp_path, worker_id="worker-test")
    assert executor.restart(run_id) is True
    with database.session() as session:
        run = session.get(ReplayRunRow, run_id)
        assert (run.state, run.current_sample) == ("ready", 0)
        assert session.query(RunStreamMessageRow).filter_by(run_id=run_id).count() == 0
        assert session.query(AnomalyEventRow).filter_by(run_id=run_id).count() == 0
        assert session.query(RunStreamMessageRow).filter_by(run_id=other_run_id).count() == 1

    with database.session() as session:
        session.get(ReplayRunRow, run_id).state = "playing"
    assert executor.tick(run_id) is True
    assert fake_engine.calls == [0]


def test_tick_rehydrates_engine_from_current_sample_after_worker_restart(
    tmp_path: Path, fake_engine
) -> None:
    _write_artifacts(tmp_path, row_count=4)
    database, run_id = _database_with_run(tmp_path, speed=1, current=3)
    executor = ReplayExecutor(database, tmp_path, worker_id="worker-restarted")

    assert executor.tick(run_id) is True
    assert fake_engine.calls == [0, 1, 2, 3]


def test_tick_writes_completion_and_failure_messages(tmp_path: Path, fake_engine) -> None:
    _write_artifacts(tmp_path, row_count=2)
    database, run_id = _database_with_run(tmp_path, speed=20)
    executor = ReplayExecutor(database, tmp_path, worker_id="worker-test")
    assert executor.tick(run_id) is True
    with database.session() as session:
        run = session.get(ReplayRunRow, run_id)
        messages = session.query(RunStreamMessageRow).filter_by(run_id=run_id).all()
        assert run.state == "completed"
        assert messages[-1].event_type == "completed"

    database, failed_run_id = _database_with_run(tmp_path, speed=1)
    fake_engine.fail = True
    executor = ReplayExecutor(database, tmp_path, worker_id="worker-test")
    assert executor.tick(failed_run_id) is False
    with database.session() as session:
        run = session.get(ReplayRunRow, failed_run_id)
        inference = session.get(RunInferenceStateRow, failed_run_id)
        messages = session.query(RunStreamMessageRow).filter_by(run_id=failed_run_id).all()
        assert run.state == "failed"
        assert inference.failure_reason == "inference failed"
        assert messages[-1].event_type == "failed"


def test_tick_persists_detected_and_updated_event_messages(tmp_path: Path, fake_engine) -> None:
    _write_artifacts(tmp_path, row_count=6)
    database, run_id = _database_with_run(tmp_path, speed=6)
    executor = ReplayExecutor(database, tmp_path, worker_id="worker-test")

    assert executor.tick(run_id) is True
    with database.session() as session:
        events = session.query(AnomalyEventRow).filter_by(run_id=run_id).all()
        messages = session.query(RunStreamMessageRow).filter_by(run_id=run_id).all()
        assert len(events) == 1
        assert events[0].sample_index == 2
        assert {message.event_type for message in messages} >= {
            "anomaly_opened",
            "diagnosis_updated",
            "completed",
        }
