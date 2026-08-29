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
    source_label: Literal[
        "Tennessee Eastman Process public simulation",
        "UCI Water Treatment Plant public sensor data",
    ]
    domain: Literal["continuous_chemical", "wastewater"]
    model_family: Literal["tep-pca-hgb", "uci-wtp-pca-softsensor"]
    sample_interval_seconds: int = Field(ge=1)
    recommended_inference_mode: Literal["online", "template"]


class CreateRunRequest(ContractModel):
    scenario_id: str
    speed: Literal[1, 5, 10, 20] = 10
    inference_mode: Literal["online", "template"] = "template"


class ReplayRun(ContractModel):
    id: UUID
    scenario_id: str
    state: Literal["ready", "playing", "paused", "completed", "failed"]
    speed: float
    current_sample: int = Field(ge=0)
    created_at: datetime
    inference_mode: Literal["online", "template"]
    model_version: str


class RunControlRequest(ContractModel):
    action: Literal["play", "pause", "restart", "seek"]
    sample_index: int | None = Field(default=None, ge=0)
    speed: Literal[1, 5, 10, 20] | None = None


class AnomalyEvent(ContractModel):
    id: UUID
    run_id: UUID
    sample_index: int
    severity: Literal["warning", "critical"]
    state: Literal["open", "confirmed", "rejected", "escalated", "resolved"]
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


class PredictionEvidence(ContractModel):
    target_id: str
    target_name: str
    unit: str
    horizon_samples: int = Field(ge=1)
    horizon_label: str
    predicted_value: float
    observed_value: float | None = None
    historical_high_boundary: float
    uncertainty_mae: float = Field(ge=0)
    lower_bound: float
    upper_bound: float
    risk_level: Literal["normal", "elevated", "high", "unknown"]
    boundary_basis: str


class EventDetail(AnomalyEvent):
    detection_sample: int = Field(ge=0)
    diagnosis_sample: int = Field(ge=0)
    diagnosis_delay_samples: int = Field(ge=0)
    diagnosis_state: Literal["pending", "provisional", "updated"]
    diagnosis_anomaly_score: float
    anomaly_latched: Literal[True]
    initial_candidates: list[FaultCandidate] = Field(max_length=3)
    candidates: list[FaultCandidate] = Field(max_length=3)
    evidence: list[EvidenceItem] = Field(min_length=3, max_length=3)
    recommendation: Recommendation
    prediction: PredictionEvidence | None = None
    model_version: str
    data_source_disclosure: Literal[
        "Public simulation data, not real Guizhou plant data.",
        "Public UCI wastewater sensor data, not real Guizhou plant data.",
    ]


class DecisionRequest(ContractModel):
    decision: Literal["confirm", "reject", "escalate"]
    decision_method: Literal["followed", "partially_followed", "overridden"] = "followed"
    note: str = Field(max_length=1000)


class DecisionRecord(ContractModel):
    id: UUID
    event_id: UUID
    decision: Literal["confirm", "reject", "escalate"]
    operator_name: str
    operator_role: str = "unknown"
    note: str
    created_at: datetime
    model_version: str
    trace_id: str


class CreateControlProposalRequest(ContractModel):
    action_draft: str = Field(min_length=1, max_length=2000)
    source_trace_id: str | None = Field(default=None, max_length=128)


class ControlCheck(ContractModel):
    name: str
    status: Literal["passed", "not_configured", "not_connected", "disabled"]
    detail: str


class ControlProposal(ContractModel):
    id: UUID
    event_id: UUID
    action_draft: str
    source_trace_id: str | None = None
    execution_mode: Literal["shadow"]
    state: Literal["blocked_demo_boundary"]
    checks: list[ControlCheck]
    requested_by: str
    sent: Literal[False]
    trace_id: str
    created_at: datetime


class AskEventRequest(ContractModel):
    question: str = Field(min_length=1, max_length=500)


class AIAnswer(ContractModel):
    answer: str
    mode: Literal["llm_enhanced", "template", "degraded"]
    model: str
    evidence_refs: list[str]
    latency_ms: float = Field(ge=0)
    trace_id: str


class ServiceStatus(ContractModel):
    status: Literal["ready", "degraded", "offline", "unknown"]
    version: str | None = None
    latency_ms: float | None = Field(default=None, ge=0)
    reason: str | None = None


class AIStatus(ContractModel):
    inference_mode: Literal["online", "template"]
    worker: ServiceStatus
    industrial_model: ServiceStatus
    language_model: ServiceStatus
    data_build_hash: str


class AIInteraction(ContractModel):
    id: UUID
    event_id: UUID
    question: str
    answer: str
    mode: Literal["llm_enhanced", "template", "degraded"]
    model: str
    evidence_refs: list[str]
    latency_ms: float = Field(ge=0)
    trace_id: str
    created_at: datetime


class AIInteractionPage(ContractModel):
    items: list[AIInteraction]
    total: int = Field(ge=0)


class AdminOverview(AIStatus):
    recent_llm_calls: list[AIInteraction] = Field(alias="recentLLMCalls")
    degraded_reasons: list[str]


class AIConfig(ContractModel):
    provider: str
    base_url: str
    model: str
    enabled: bool
    timeout_ms: int = Field(ge=1, le=120_000)
    max_tokens: int = Field(ge=1, le=32_768)
    temperature: float = Field(ge=0, le=2)
    prompt_version: str
    fallback_policy: Literal["template", "degraded"]
    api_key_configured: bool
    version: int = Field(ge=1)


class UpdateAIConfigRequest(ContractModel):
    provider: str | None = Field(default=None, min_length=1)
    base_url: str | None = None
    model: str | None = Field(default=None, min_length=1)
    enabled: bool | None = None
    timeout_ms: int | None = Field(default=None, ge=1, le=120_000)
    max_tokens: int | None = Field(default=None, ge=1, le=32_768)
    temperature: float | None = Field(default=None, ge=0, le=2)
    prompt_version: str | None = Field(default=None, min_length=1)
    fallback_policy: Literal["template", "degraded"] | None = None
    api_key: str | None = Field(default=None, min_length=1)
    clear_api_key: bool = False
    expected_version: int | None = Field(default=None, ge=0)


class AIConnectionTestRequest(ContractModel):
    question: str = Field(default="请用一句话确认连接正常。", min_length=1, max_length=500)


class AIConnectionTestResponse(ContractModel):
    ok: bool
    mode: Literal["llm_enhanced", "degraded"]
    provider: str
    model: str
    latency_ms: float = Field(ge=0)
    trace_id: str
    error: str | None = None


class AdminAuditChangeSummary(ContractModel):
    changed_fields: list[str]
    previous_version: str
    current_version: str
    api_key_changed: bool | None = None


class AdminAuditEntry(ContractModel):
    id: UUID
    actor: str
    action: str
    resource_type: str
    resource_id: str
    created_at: datetime
    trace_id: str
    request_id: str
    change_summary: AdminAuditChangeSummary


class AdminAuditPage(ContractModel):
    items: list[AdminAuditEntry]
    total: int = Field(ge=0)


class Problem(ContractModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
    trace_id: str
