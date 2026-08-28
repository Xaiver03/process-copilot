"""Durable, single-process execution of online replay runs.

The executor owns no control-system side effects.  It reads one scenario's
telemetry and the frozen model artifacts, then persists inference messages and
anomaly transitions in the API database.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from pathlib import Path
from typing import Any
from uuid import uuid4

import pyarrow.parquet as parquet
from process_copilot_ml import OnlineInferenceEngine
from sqlalchemy import delete, select

from .db import (
    AnomalyEventRow,
    Database,
    ReplayRunRow,
    RunInferenceStateRow,
    RunStreamMessageRow,
)

_RAW_VARIABLE = re.compile(r"^(?:XMEAS|XMV)\([0-9]+\)$")
_BATCH_LIMIT = 20
_SAFETY_BOUNDARY = "Read-only advice. No automatic control write-back."


def _contract_alarm_state(value: str) -> str:
    return {
        "normal": "normal",
        "pending": "warning",
        "recovering": "warning",
        "open": "critical",
    }.get(
        value,
        "warning",
    )


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass
class _RunContext:
    engine: OnlineInferenceEngine
    rows: list[dict[str, Any]]
    processed_until: int


class ReplayExecutor:
    """Advance online runs by bounded batches and persist their facts."""

    def __init__(self, database: Database, data_dir: str | Path, worker_id: str = "worker") -> None:
        self.database = database
        self.data_dir = Path(data_dir)
        self.worker_id = worker_id
        self._contexts: dict[str, _RunContext] = {}

    def tick(self, run_id: str) -> bool:
        """Process at most ``min(int(speed), 20)`` samples for one playing run."""

        context: _RunContext | None = None
        try:
            with self.database.session() as session:
                run = session.get(ReplayRunRow, str(run_id))
                if run is None:
                    return False
                inference = session.get(RunInferenceStateRow, str(run_id))
                if inference is None or inference.mode != "online" or run.state != "playing":
                    return False

                inference.worker_id = self.worker_id
                inference.heartbeat_at = _now()
                context = self._context(run, inference)
                batch_size = min(int(run.speed), _BATCH_LIMIT)
                processed = 0
                while processed < batch_size and run.current_sample < len(context.rows):
                    sample_index = run.current_sample
                    result = context.engine.process(
                        sample_index=sample_index,
                        values=self._raw_values(context.rows[sample_index]),
                    )
                    self._persist_inference(session, run, result)
                    self._persist_transition(session, run, result)
                    run.current_sample += 1
                    context.processed_until = run.current_sample
                    processed += 1

                if run.current_sample >= len(context.rows):
                    run.state = "completed"
                    self._append_message(
                        session,
                        run.id,
                        "completed",
                        None,
                        {"runId": run.id, "currentSample": run.current_sample},
                    )
                return processed > 0 or run.state == "completed"
        except Exception as exc:
            self._contexts.pop(str(run_id), None)
            self._mark_failed(str(run_id), str(exc))
            return False

    def restart(self, run_id: str) -> bool:
        """Clear one run's online products and reset its state to ``ready``."""

        run_key = str(run_id)
        with self.database.session() as session:
            run = session.get(ReplayRunRow, run_key)
            inference = session.get(RunInferenceStateRow, run_key)
            if run is None or inference is None or inference.mode != "online":
                return False
            session.execute(
                delete(RunStreamMessageRow).where(RunStreamMessageRow.run_id == run_key)
            )
            session.execute(delete(AnomalyEventRow).where(AnomalyEventRow.run_id == run_key))
            run.current_sample = 0
            run.state = "ready"
            inference.failure_reason = None
            inference.worker_id = None
            inference.heartbeat_at = None
        self._contexts.pop(run_key, None)
        return True

    def _context(self, run: ReplayRunRow, inference: RunInferenceStateRow) -> _RunContext:
        current = self._contexts.get(run.id)
        if current is not None and current.processed_until == run.current_sample:
            return current
        rows = self._read_rows(run.scenario_id)
        engine = OnlineInferenceEngine.from_artifacts(
            self.data_dir / "models", self.data_dir / "variable_dictionary.json"
        )
        current = _RunContext(engine=engine, rows=rows, processed_until=0)
        for index in range(min(run.current_sample, len(rows))):
            engine.process(sample_index=index, values=self._raw_values(rows[index]))
        current.processed_until = min(run.current_sample, len(rows))
        self._contexts[run.id] = current
        if inference.model_version != engine.model_version:
            inference.model_version = engine.model_version
        return current

    def _read_rows(self, scenario_id: str) -> list[dict[str, Any]]:
        telemetry = self.data_dir / "scenarios" / scenario_id / "telemetry.parquet"
        if not telemetry.is_file():
            raise FileNotFoundError(f"telemetry not found for scenario {scenario_id}")
        return parquet.read_table(telemetry).to_pylist()

    @staticmethod
    def _raw_values(row: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in row.items() if _RAW_VARIABLE.fullmatch(key)}

    def _persist_inference(self, session: Any, run: ReplayRunRow, result: Any) -> None:
        numeric_values = (result.t2, result.spe, result.anomaly_score, result.latency_ms)
        if any(value is None or not isfinite(float(value)) for value in numeric_values):
            return
        payload = {
            "runId": run.id,
            "sampleIndex": result.sample_index,
            "t2": result.t2,
            "spe": result.spe,
            "anomalyScore": result.anomaly_score,
            "alarmState": _contract_alarm_state(result.alarm_state),
            "modelVersion": result.model_version,
            "latencyMs": result.latency_ms,
        }
        self._append_message(session, run.id, "inference", result.sample_index, payload)

    def _persist_transition(self, session: Any, run: ReplayRunRow, result: Any) -> None:
        if result.transition == "detected":
            event_id = str(uuid4())
            detail = self._detail(result, run.id, event_id, "provisional")
            session.add(
                AnomalyEventRow(
                    id=event_id,
                    run_id=run.id,
                    sample_index=result.sample_index,
                    severity="critical" if result.alarm_state == "open" else "warning",
                    state="open",
                    anomaly_score=float(result.anomaly_score or 0),
                    detail=detail,
                )
            )
            self._append_message(
                session,
                run.id,
                "anomaly_opened",
                result.sample_index,
                {"runId": run.id, "eventId": event_id, "sampleIndex": result.sample_index},
            )
        elif result.transition == "updated":
            event = session.scalars(
                select(AnomalyEventRow)
                .where(AnomalyEventRow.run_id == run.id, AnomalyEventRow.state == "open")
                .order_by(AnomalyEventRow.sample_index.desc(), AnomalyEventRow.id.desc())
            ).first()
            if event is None:
                return
            detail = dict(event.detail or {})
            detail.update(self._detail(result, run.id, event.id, "updated"))
            event.detail = detail
            self._append_message(
                session,
                run.id,
                "diagnosis_updated",
                result.sample_index,
                {"runId": run.id, "eventId": event.id, "sampleIndex": result.sample_index},
            )
        elif result.transition == "closed":
            event = session.scalars(
                select(AnomalyEventRow)
                .where(AnomalyEventRow.run_id == run.id, AnomalyEventRow.state == "open")
                .order_by(AnomalyEventRow.sample_index.desc(), AnomalyEventRow.id.desc())
            ).first()
            if event is None:
                return
            detail = dict(event.detail or {})
            detail.update(
                {
                    "state": "resolved",
                    "diagnosisSample": result.sample_index,
                    "diagnosisState": "updated",
                    "diagnosisAnomalyScore": float(result.anomaly_score or 0),
                    "modelVersion": result.model_version,
                }
            )
            event.detail = detail
            event.state = "resolved"
            self._append_message(
                session,
                run.id,
                "diagnosis_updated",
                result.sample_index,
                {
                    "runId": run.id,
                    "eventId": event.id,
                    "sampleIndex": result.sample_index,
                    "state": "resolved",
                },
            )

    def _detail(
        self,
        result: Any,
        run_id: str,
        event_id: str,
        diagnosis_state: str,
        *,
        event_state: str = "open",
    ) -> dict[str, Any]:
        candidates = result.initial_candidates or result.updated_candidates or ()
        updated = result.updated_candidates or candidates
        evidence = []
        for item in result.evidence:
            evidence.append(
                {
                    **item,
                    "summary": item.get("summary", "在线模型贡献度证据"),
                    "values": item.get("values", []),
                }
            )
        return {
            "id": event_id,
            "runId": run_id,
            "sampleIndex": result.sample_index,
            "severity": "critical" if result.alarm_state == "open" else "warning",
            "state": event_state,
            "anomalyScore": float(result.anomaly_score or 0),
            "detectionSample": result.sample_index,
            "diagnosisSample": result.sample_index,
            "diagnosisDelaySamples": 20,
            "diagnosisState": diagnosis_state,
            "diagnosisAnomalyScore": float(result.anomaly_score or 0),
            "anomalyLatched": True,
            "initialCandidates": self._candidates(candidates),
            "candidates": self._candidates(updated),
            "evidence": evidence,
            "recommendation": {
                "mode": "template",
                "risk": "Review online model evidence before action.",
                "checks": ["核对 Top-3 变量趋势"],
                "actions": ["人工确认后再处置"],
                "safetyBoundary": _SAFETY_BOUNDARY,
            },
            "modelVersion": result.model_version,
            "dataSourceDisclosure": "Public simulation data, not real Guizhou plant data.",
        }

    @staticmethod
    def _candidates(values: Any) -> list[dict[str, Any]]:
        return [
            {
                "faultId": int(fault_id),
                "label": f"Fault {int(fault_id)}",
                "probability": float(probability),
            }
            for fault_id, probability in values
        ]

    @staticmethod
    def _append_message(
        session: Any,
        run_id: str,
        event_type: str,
        sample_index: int | None,
        payload: dict[str, Any],
    ) -> None:
        session.add(
            RunStreamMessageRow(
                run_id=run_id,
                event_type=event_type,
                sample_index=sample_index,
                payload=payload,
                created_at=_now(),
            )
        )

    def _mark_failed(self, run_id: str, reason: str) -> None:
        try:
            with self.database.session() as session:
                run = session.get(ReplayRunRow, run_id)
                inference = session.get(RunInferenceStateRow, run_id)
                if run is None or inference is None:
                    return
                run.state = "failed"
                inference.failure_reason = reason[:1000]
                inference.worker_id = self.worker_id
                inference.heartbeat_at = _now()
                self._append_message(
                    session,
                    run_id,
                    "failed",
                    run.current_sample,
                    {"runId": run_id, "error": reason[:1000]},
                )
        except Exception:
            # A database outage must not crash the long-running worker process.
            return
