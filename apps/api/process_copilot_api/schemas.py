from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


class Health(ContractModel):
    status: Literal["ok", "degraded"]
    checks: dict[str, str] | None = None


class Scenario(ContractModel):
    id: str
    name: str
    description: str | None = None
    fault_id: int = Field(ge=0, le=21)
    sample_count: int = Field(ge=1)
    fault_onset_sample: int = Field(ge=0)
    source_label: Literal["Tennessee Eastman Process public simulation"]


class CreateRunRequest(ContractModel):
    scenario_id: str
    speed: Literal[1, 5, 10, 20] = 10


class ReplayRun(ContractModel):
    id: UUID
    scenario_id: str
    state: Literal["ready", "playing", "paused", "completed", "failed"]
    speed: float
    current_sample: int = Field(ge=0)
    created_at: datetime


class RunControlRequest(ContractModel):
    action: Literal["play", "pause", "restart", "seek"]
    sample_index: int | None = Field(default=None, ge=0)
    speed: Literal[1, 5, 10, 20] | None = None


class AnomalyEvent(ContractModel):
    id: UUID
    run_id: UUID
    sample_index: int
    severity: Literal["warning", "critical"]
    state: Literal["open", "confirmed", "rejected", "escalated"]
    anomaly_score: float


class FaultCandidate(ContractModel):
    fault_id: int = Field(ge=0, le=21)
    label: str
    probability: float = Field(ge=0, le=1)


class EvidenceItem(ContractModel):
    variable_id: str
    variable_name: str
    unit: str
    contribution: float = Field(ge=0)
    direction: Literal["up", "down", "mixed"]
    summary: str
    values: list[float]


class Recommendation(ContractModel):
    mode: Literal["template", "llm_enhanced", "degraded"]
    risk: str
    checks: list[str]
    actions: list[str]
    safety_boundary: Literal["Read-only advice. No automatic control write-back."]


class EventDetail(AnomalyEvent):
    detection_sample: int = Field(ge=0)
    diagnosis_sample: int = Field(ge=0)
    diagnosis_delay_samples: Literal[20]
    diagnosis_state: Literal["pending", "provisional", "updated"]
    diagnosis_anomaly_score: float
    anomaly_latched: Literal[True]
    initial_candidates: list[FaultCandidate] = Field(max_length=3)
    candidates: list[FaultCandidate] = Field(max_length=3)
    evidence: list[EvidenceItem] = Field(min_length=3, max_length=3)
    recommendation: Recommendation
    model_version: str
    data_source_disclosure: Literal["Public simulation data, not real Guizhou plant data."]


class DecisionRequest(ContractModel):
    decision: Literal["confirm", "reject", "escalate"]
    operator_name: str = Field(min_length=1, max_length=80)
    note: str = Field(max_length=1000)


class DecisionRecord(ContractModel):
    id: UUID
    event_id: UUID
    decision: Literal["confirm", "reject", "escalate"]
    operator_name: str
    note: str
    created_at: datetime
    model_version: str
    trace_id: str


class Problem(ContractModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
    trace_id: str
