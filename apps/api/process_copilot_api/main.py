from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from .ai_config import AIConfigPatch, AIConfigService, AIConfigValidationError
from .ai_config_store import AIConfigConflictError, SQLAlchemyAIConfigRepository
from .auth import (
    ROLE_ORDER,
    LoginRequestModel,
    LoginResponse,
    authenticate,
    current_operator,
    require_role,
    seed_operators,
)
from .catalog import DataCatalog
from .crypto import EncryptionKeyError, decrypt_api_key
from .db import (
    AdminAuditRow,
    AIInteractionRow,
    AnomalyEventRow,
    AuditRow,
    Database,
    DecisionRow,
    IdempotencyRow,
    ReplayRunRow,
    RunInferenceStateRow,
    RunStreamMessageRow,
)
from .llm import ExplanationEnhancer, LLMSettings
from .schemas import (
    AdminAuditChangeSummary,
    AdminAuditEntry,
    AdminAuditPage,
    AdminOverview,
    AIAnswer,
    AIConfig,
    AIConnectionTestRequest,
    AIConnectionTestResponse,
    AIInteraction,
    AIInteractionPage,
    AIStatus,
    AnomalyEvent,
    AskEventRequest,
    CreateRunRequest,
    DecisionRecord,
    DecisionRequest,
    EventDetail,
    EvidenceItem,
    FaultCandidate,
    Health,
    Problem,
    Recommendation,
    ReplayRun,
    RunControlRequest,
    Scenario,
    ServiceStatus,
    UpdateAIConfigRequest,
)
from .worker import check_worker, inspect_processed_data

DEFAULT_SOURCE_DISCLOSURE = "Public simulation data, not real Guizhou plant data."
DEFAULT_SAFETY_BOUNDARY = "Read-only advice. No automatic control write-back."
DEGRADED_FALLBACK_MODEL_VERSION = "degraded-demo-fallback-v0.1"
DEGRADED_FALLBACK_RISK = (
    "演示降级：事件模板缺失或无效，以下证据为固定占位内容，不代表真实模型计算结果。"
)
DEFAULT_SSE_HEARTBEAT_INTERVAL_SECONDS = 15.0
DEFAULT_SSE_HEARTBEAT_COUNT: int | None = None


class APIError(Exception):
    def __init__(
        self, status_code: int, code: str, message: str, details: dict[str, Any] | None = None
    ):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _default_database_url() -> str:
    configured = os.getenv("DATABASE_URL")
    if configured:
        return configured
    project_root = Path(__file__).resolve().parents[3]
    return f"sqlite:///{project_root / 'apps' / 'api' / 'process_copilot.db'}"


def _default_data_dir() -> Path:
    configured = os.getenv("DEMO_DATA_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[3] / "data" / "processed"


def _problem(
    request: Request, code: str, message: str, details: dict[str, Any] | None = None
) -> Problem:
    return Problem(code=code, message=message, details=details, trace_id=request.state.trace_id)


def _sse_frame(event_id: int, event: str, payload: Any) -> str:
    encoded = json.dumps(jsonable_encoder(payload), ensure_ascii=False, separators=(",", ":"))
    return f"id: {event_id}\nevent: {event}\ndata: {encoded}\n\n"


def _run_response(row: ReplayRunRow, inference: RunInferenceStateRow | None) -> ReplayRun:
    return ReplayRun(
        id=UUID(row.id),
        scenario_id=row.scenario_id,
        state=row.state,
        speed=row.speed,
        current_sample=row.current_sample,
        created_at=row.created_at.replace(tzinfo=UTC),
        inference_mode=inference.mode if inference is not None else "template",
        model_version=(
            inference.model_version if inference is not None else DEGRADED_FALLBACK_MODEL_VERSION
        ),
    )


def _online_model_version(data_dir: Path) -> str:
    manifest = data_dir / "models" / "model_manifest.json"
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return "online-model-pending"
    version = payload.get("modelVersion")
    return version if isinstance(version, str) and version else "online-model-pending"


def _append_stream_message(
    session: Any,
    run_id: str,
    event_type: str,
    sample_index: int | None,
    payload: dict[str, Any],
) -> RunStreamMessageRow:
    row = RunStreamMessageRow(
        run_id=run_id,
        event_type=event_type,
        sample_index=sample_index,
        payload=payload,
        created_at=_now(),
    )
    session.add(row)
    return row


def _stream_payload(row: RunStreamMessageRow) -> dict[str, Any]:
    payload = dict(row.payload or {})
    message: dict[str, Any] = {
        "type": row.event_type,
        "sequence": row.id,
        "runId": row.run_id,
        "emittedAt": row.created_at.replace(tzinfo=UTC),
    }
    if row.sample_index is not None:
        message["sampleIndex"] = row.sample_index
    if row.event_type == "inference":
        message["inference"] = payload
    elif row.event_type == "state":
        message["state"] = payload.get("state", "ready")
    elif row.event_type == "anomaly_opened":
        message.update(
            eventId=payload.get("eventId"),
            diagnosisState=payload.get("diagnosisState", "provisional"),
        )
    elif row.event_type == "diagnosis_updated":
        message.update(
            eventId=payload.get("eventId"),
            diagnosisState=payload.get("diagnosisState", "updated"),
        )
    elif row.event_type == "completed":
        message["state"] = "completed"
    elif row.event_type == "failed":
        message.update(
            state="failed",
            errorCode="online_inference_failed",
            message="在线推理未完成，请由管理员检查 Worker 与模型状态。",
        )
    return message


def _event_response(row: AnomalyEventRow) -> AnomalyEvent:
    return AnomalyEvent(
        id=UUID(row.id),
        run_id=UUID(row.run_id),
        sample_index=row.sample_index,
        severity=row.severity,
        state=row.state,
        anomaly_score=row.anomaly_score,
    )


def _event_detail(row: AnomalyEventRow) -> EventDetail:
    event = _event_response(row)
    return EventDetail.model_validate({**(row.detail or {}), **event.model_dump()})


def _public_ai_config(config: Any) -> AIConfig:
    return AIConfig(
        provider=config.provider,
        base_url=config.baseUrl,
        model=config.model,
        enabled=config.enabled,
        timeout_ms=config.timeout * 1000,
        max_tokens=config.maxTokens,
        temperature=config.temperature,
        prompt_version=config.promptVersion,
        fallback_policy=config.fallbackMode,
        api_key_configured=config.apiKeyConfigured,
        version=config.version,
    )


def _interaction_response(row: AIInteractionRow) -> AIInteraction:
    return AIInteraction(
        id=UUID(row.id),
        event_id=UUID(row.event_id),
        question=row.question,
        answer=row.answer,
        mode=row.mode,
        model=row.model,
        evidence_refs=list(row.evidence_refs or []),
        latency_ms=row.latency_ms,
        trace_id=row.trace_id,
        created_at=row.created_at.replace(tzinfo=UTC),
    )


def _admin_audit_response(row: AdminAuditRow) -> AdminAuditEntry:
    summary = row.change_summary or {}
    return AdminAuditEntry(
        id=UUID(row.id),
        actor=row.actor,
        action=row.action,
        resource_type=row.resource_type,
        resource_id=row.resource_id,
        created_at=row.created_at.replace(tzinfo=UTC),
        trace_id=row.trace_id,
        request_id=row.request_id,
        change_summary=AdminAuditChangeSummary(
            changed_fields=list(summary.get("changedFields", [])),
            previous_version=str(summary.get("previousVersion", "unknown")),
            current_version=str(summary.get("currentVersion", "unknown")),
            api_key_changed=summary.get("apiKeyChanged"),
        ),
    )


def _data_build_hash(data_dir: Path) -> str:
    manifest = data_dir / "manifest.json"
    if not manifest.is_file():
        return "unavailable"
    try:
        return sha256(manifest.read_bytes()).hexdigest()[:16]
    except OSError:
        return "unavailable"


def _request_fingerprint(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def _idempotent(session: Any, scope: str, key: str | None, payload: Any) -> IdempotencyRow | None:
    if not key:
        return None
    previous = session.get(IdempotencyRow, f"{scope}:{key}")
    if previous and previous.fingerprint != _request_fingerprint(payload):
        raise APIError(
            409,
            "idempotency_conflict",
            "Idempotency-Key was already used with a different request",
        )
    return previous


def _save_idempotency(
    session: Any,
    scope: str,
    key: str | None,
    payload: Any,
    response: Any,
    status_code: int,
) -> None:
    if key:
        session.add(
            IdempotencyRow(
                id=f"{scope}:{key}",
                fingerprint=_request_fingerprint(payload),
                response=jsonable_encoder(response),
                status_code=status_code,
            )
        )


def _fallback_detail(
    event_id: UUID,
    run_id: UUID,
    scenario: Scenario,
    template: dict[str, Any] | None = None,
) -> EventDetail:
    if isinstance(template, dict) and template:
        try:
            return EventDetail.model_validate(
                {
                    **template,
                    "id": event_id,
                    "runId": run_id,
                    "state": "open",
                    "severity": "critical" if scenario.fault_id else "warning",
                }
            )
        except ValidationError:
            pass
    candidates = [
        FaultCandidate(fault_id=scenario.fault_id, label=scenario.name, probability=0.72),
        FaultCandidate(
            fault_id=(scenario.fault_id + 1) % 22, label="相关过程扰动", probability=0.18
        ),
        FaultCandidate(
            fault_id=(scenario.fault_id + 2) % 22, label="测量或执行器异常", probability=0.10
        ),
    ]
    detection_sample = scenario.fault_onset_sample
    diagnosis_sample = min(detection_sample + 20, scenario.sample_count - 1)
    evidence = [
        EvidenceItem(
            variable_id="XMEAS(1)",
            variable_name="进料流量",
            unit="%",
            contribution=0.91,
            direction="up",
            summary="演示降级占位证据：偏离正常工况基线，优先核对流量回路。",
            values=[0.32, 0.48, 0.67],
        ),
        EvidenceItem(
            variable_id="XMEAS(2)",
            variable_name="反应器压力",
            unit="kPa",
            contribution=0.74,
            direction="up",
            summary="演示降级占位证据：与偏移窗口同步上升，作为第二检查点。",
            values=[0.20, 0.42, 0.63],
        ),
        EvidenceItem(
            variable_id="XMV(1)",
            variable_name="冷却水阀位",
            unit="%",
            contribution=0.61,
            direction="down",
            summary="演示降级占位证据：执行器侧变化与异常方向相反，需现场确认。",
            values=[0.74, 0.60, 0.45],
        ),
    ]
    return EventDetail(
        id=event_id,
        run_id=run_id,
        sample_index=scenario.fault_onset_sample,
        severity="critical" if scenario.fault_id else "warning",
        state="open",
        anomaly_score=0.87,
        detection_sample=detection_sample,
        diagnosis_sample=diagnosis_sample,
        diagnosis_delay_samples=20,
        diagnosis_state="provisional",
        diagnosis_anomaly_score=0.87,
        anomaly_latched=True,
        initial_candidates=candidates,
        candidates=candidates,
        evidence=evidence,
        recommendation=Recommendation(
            mode="degraded",
            risk=DEGRADED_FALLBACK_RISK,
            checks=["核对进料流量与压力趋势", "确认冷却水阀位和仪表状态"],
            actions=["按 Top-3 变量顺序人工检查", "必要时通知工艺负责人"],
            safety_boundary=DEFAULT_SAFETY_BOUNDARY,
        ),
        model_version=DEGRADED_FALLBACK_MODEL_VERSION,
        data_source_disclosure=DEFAULT_SOURCE_DISCLOSURE,
    )


def create_app(
    database_url: str | None = None,
    data_dir: str | Path | None = None,
    sse_heartbeat_interval_seconds: float = DEFAULT_SSE_HEARTBEAT_INTERVAL_SECONDS,
    sse_heartbeat_count: int | None = DEFAULT_SSE_HEARTBEAT_COUNT,
) -> FastAPI:
    if sse_heartbeat_interval_seconds <= 0:
        raise ValueError("sse_heartbeat_interval_seconds must be positive")
    if sse_heartbeat_count is not None and sse_heartbeat_count < 1:
        raise ValueError("sse_heartbeat_count must be positive or None")
    app = FastAPI(
        title="Wuno Process Copilot API",
        version="0.1.0",
        description="Read-only demo API for Tennessee Eastman Process public simulation data.",
        openapi_version="3.1.0",
    )
    app.state.database = Database(database_url or _default_database_url())
    app.state.database.create_schema()
    app.state.catalog = DataCatalog(data_dir or _default_data_dir())
    app.state.sse_heartbeat_interval_seconds = sse_heartbeat_interval_seconds
    app.state.sse_heartbeat_count = sse_heartbeat_count
    seed_operators(app.state.database)
    app.state.ai_config_repository = SQLAlchemyAIConfigRepository(app.state.database)
    app.state.ai_config_service = AIConfigService(app.state.ai_config_repository)
    if app.state.ai_config_service.get() is None:
        app.state.ai_config_service.update(
            AIConfigPatch(
                enabled=False,
                provider="disabled",
                baseUrl="https://localhost",
                model="not-configured",
                timeout=8,
                maxTokens=500,
                temperature=0.2,
                promptVersion="event-copilot-v01",
                fallbackMode="template",
            )
        )
    app.state.ai_test_attempts = defaultdict(list)

    def runtime_llm_settings() -> LLMSettings:
        stored = app.state.ai_config_repository.load()
        if stored is None:
            return LLMSettings.from_env()
        config = stored.config
        api_key = ""
        if stored.api_key_ciphertext:
            api_key = decrypt_api_key(stored.api_key_ciphertext)
        return LLMSettings(
            provider=config.provider if config.enabled else "disabled",
            base_url=config.baseUrl.rstrip("/"),
            model=config.model,
            api_key=api_key,
            timeout_seconds=config.timeout,
            max_tokens=config.maxTokens,
            prompt_version=config.promptVersion,
        )

    def current_ai_status() -> AIStatus:
        config = app.state.ai_config_service.get()
        worker_status = ServiceStatus(status="unknown", reason="尚无 worker 心跳")
        with app.state.database.session() as session:
            latest = session.scalars(
                select(RunInferenceStateRow)
                .where(RunInferenceStateRow.heartbeat_at.is_not(None))
                .order_by(RunInferenceStateRow.heartbeat_at.desc())
                .limit(1)
            ).first()
            if latest is not None:
                worker_status = ServiceStatus(
                    status="degraded" if latest.failure_reason else "ready",
                    version=latest.worker_id,
                    reason=latest.failure_reason,
                )
        snapshot = inspect_processed_data(data_dir or _default_data_dir())
        industrial_status = ServiceStatus(
            status="ready" if snapshot["modelReady"] else "degraded",
            version="tep-pca-hgb-online-v01" if snapshot["modelReady"] else None,
            reason=None if snapshot["modelReady"] else snapshot["message"],
        )
        if config is None or not config.enabled:
            language_status = ServiceStatus(status="offline", reason="语言模型增强未启用")
        elif not config.apiKeyConfigured:
            language_status = ServiceStatus(
                status="degraded",
                version=config.model,
                reason="Provider API Key 尚未配置",
            )
        else:
            language_status = ServiceStatus(status="ready", version=config.model)
        return AIStatus(
            inference_mode=os.getenv("INFERENCE_MODE", "online").strip().lower()
            if os.getenv("INFERENCE_MODE", "online").strip().lower() in {"online", "template"}
            else "template",
            worker=worker_status,
            industrial_model=industrial_status,
            language_model=language_status,
            data_build_hash=_data_build_hash(Path(data_dir or _default_data_dir())),
        )

    @app.middleware("http")
    async def trace_middleware(request: Request, call_next: Any) -> Any:
        supplied = request.headers.get("X-Trace-ID", "").strip()
        request.state.trace_id = supplied[:128] or str(uuid4())
        response = await call_next(request)
        response.headers["X-Trace-ID"] = request.state.trace_id
        return response

    @app.exception_handler(APIError)
    async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=jsonable_encoder(_problem(request, exc.code, exc.message, exc.details)),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=jsonable_encoder(
                _problem(
                    request,
                    "validation_error",
                    "Request validation failed",
                    {"errors": exc.errors()},
                )
            ),
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content=jsonable_encoder(
                _problem(request, "internal_error", "The request could not be completed")
            ),
        )

    @app.post("/api/v1/auth/login", response_model=LoginResponse, operation_id="login")
    def login(body: LoginRequestModel) -> LoginResponse:
        try:
            return authenticate(app.state.database, body.username, body.password)
        except PermissionError:
            raise APIError(
                401, "invalid_credentials", "Username or password is incorrect"
            ) from None

    @app.get("/api/v1/auth/me", operation_id="me")
    def me(operator: Annotated[Any, Depends(current_operator)]) -> dict[str, str]:
        return {
            "username": operator.username,
            "role": operator.role,
            "displayName": operator.display_name,
        }

    @app.get(
        "/api/v1/admin/ai/status",
        response_model=AIStatus,
        operation_id="getAIStatus",
    )
    def get_ai_status(
        _operator: Annotated[Any, Depends(require_role("admin"))],
    ) -> AIStatus:
        return current_ai_status()

    @app.get(
        "/api/v1/admin/overview",
        response_model=AdminOverview,
        operation_id="getAdminOverview",
    )
    def get_admin_overview(
        _operator: Annotated[Any, Depends(require_role("admin"))],
    ) -> AdminOverview:
        status = current_ai_status()
        with app.state.database.session() as session:
            rows = list(
                session.scalars(
                    select(AIInteractionRow)
                    .order_by(AIInteractionRow.created_at.desc())
                    .limit(5)
                )
            )
        degraded_reasons = [
            service.reason
            for service in (status.worker, status.industrial_model, status.language_model)
            if service.status != "ready" and service.reason
        ]
        return AdminOverview(
            **status.model_dump(),
            recent_llm_calls=[_interaction_response(row) for row in rows],
            degraded_reasons=degraded_reasons,
        )

    @app.get(
        "/api/v1/admin/ai/config",
        response_model=AIConfig,
        operation_id="getAIConfig",
    )
    def get_ai_config(
        _operator: Annotated[Any, Depends(require_role("admin"))],
    ) -> AIConfig:
        config = app.state.ai_config_service.get()
        if config is None:
            raise APIError(503, "ai_config_unavailable", "AI configuration is unavailable")
        return _public_ai_config(config)

    @app.put(
        "/api/v1/admin/ai/config",
        response_model=AIConfig,
        operation_id="updateAIConfig",
    )
    def update_ai_config(
        request: Request,
        body: UpdateAIConfigRequest,
        operator: Annotated[Any, Depends(require_role("admin"))],
        idempotency_key: str | None = Header(
            default=None, alias="Idempotency-Key", max_length=128
        ),
    ) -> Any:
        payload = body.model_dump(mode="json", by_alias=True, exclude_unset=True)
        with app.state.database.session() as session:
            previous_response = _idempotent(
                session,
                "admin-ai-config",
                idempotency_key,
                payload,
            )
            if previous_response:
                return JSONResponse(
                    status_code=previous_response.status_code,
                    content=previous_response.response,
                )
        previous = app.state.ai_config_service.get()
        if previous is None:
            raise APIError(503, "ai_config_unavailable", "AI configuration is unavailable")
        if body.expected_version is not None and body.expected_version != previous.version:
            raise APIError(
                409,
                "ai_config_version_conflict",
                "AI configuration was changed by another administrator",
                {"currentVersion": previous.version},
            )
        patch_fields: dict[str, Any] = {}
        field_mapping = {
            "enabled": "enabled",
            "provider": "provider",
            "base_url": "baseUrl",
            "model": "model",
            "max_tokens": "maxTokens",
            "temperature": "temperature",
            "prompt_version": "promptVersion",
            "fallback_policy": "fallbackMode",
            "api_key": "apiKey",
            "clear_api_key": "clearApiKey",
        }
        for source, target in field_mapping.items():
            if source in body.model_fields_set:
                patch_fields[target] = getattr(body, source)
        if "timeout_ms" in body.model_fields_set:
            patch_fields["timeout"] = max(1, (body.timeout_ms + 999) // 1000)
        try:
            updated = app.state.ai_config_service.update(AIConfigPatch(**patch_fields))
        except AIConfigConflictError:
            raise APIError(
                409,
                "ai_config_version_conflict",
                "AI configuration was changed by another administrator",
            ) from None
        except (AIConfigValidationError, EncryptionKeyError, TypeError) as exc:
            raise APIError(422, "invalid_ai_config", str(exc)) from None
        response = _public_ai_config(updated)
        changed_fields = sorted(
            {
                {
                    "base_url": "baseUrl",
                    "max_tokens": "maxTokens",
                    "prompt_version": "promptVersion",
                    "fallback_policy": "fallbackPolicy",
                    "api_key": "apiKeyConfigured",
                    "clear_api_key": "apiKeyConfigured",
                }.get(field, field)
                for field in body.model_fields_set
                if field != "expected_version"
            }
        )
        created_at = _now()
        with app.state.database.session() as session:
            session.add(
                AdminAuditRow(
                    id=str(uuid4()),
                    actor=operator.username,
                    action="ai_config_updated",
                    resource_type="ai_configuration",
                    resource_id="default",
                    change_summary={
                        "changedFields": changed_fields,
                        "previousVersion": str(previous.version),
                        "currentVersion": str(updated.version),
                        "apiKeyChanged": bool(
                            {"api_key", "clear_api_key"} & body.model_fields_set
                        ),
                    },
                    trace_id=request.state.trace_id,
                    request_id=idempotency_key or request.state.trace_id,
                    created_at=created_at,
                )
            )
            _save_idempotency(
                session,
                "admin-ai-config",
                idempotency_key,
                payload,
                response,
                200,
            )
        return response

    @app.post(
        "/api/v1/admin/ai/test",
        response_model=AIConnectionTestResponse,
        operation_id="testAIConnection",
    )
    def test_ai_connection(
        request: Request,
        body: AIConnectionTestRequest | None = None,
        operator: Annotated[Any, Depends(require_role("admin"))] = None,
    ) -> AIConnectionTestResponse:
        now_timestamp = datetime.now(UTC).timestamp()
        attempts = [
            timestamp
            for timestamp in app.state.ai_test_attempts[operator.username]
            if now_timestamp - timestamp < 60
        ]
        if len(attempts) >= 3:
            raise APIError(429, "ai_test_rate_limited", "Connection test limit exceeded")
        attempts.append(now_timestamp)
        app.state.ai_test_attempts[operator.username] = attempts
        question = body.question if body is not None else "请用一句话确认连接正常。"
        error: str | None = None
        try:
            settings = runtime_llm_settings()
            result = ExplanationEnhancer(settings).enhance(
                {
                    "eventId": str(UUID(int=0)),
                    "sampleIndex": 0,
                    "severity": "warning",
                    "anomalyScore": 0,
                    "modelVersion": "connection-test",
                    "evidence": [{"variableId": "XMEAS(1)"}],
                },
                question,
                trace_id=request.state.trace_id,
            )
            ok = result.mode == "llm_enhanced"
            mode = "llm_enhanced" if ok else "degraded"
            error = None if ok else result.fallback_reason or "template_fallback"
            provider = settings.provider
            model = settings.model or "not-configured"
            latency_ms = result.latency_ms
        except EncryptionKeyError:
            ok = False
            mode = "degraded"
            provider = "unavailable"
            model = "not-configured"
            latency_ms = 0
            error = "encrypted_key_unavailable"
        response = AIConnectionTestResponse(
            ok=ok,
            mode=mode,
            provider=provider,
            model=model,
            latency_ms=latency_ms,
            trace_id=request.state.trace_id,
            error=error,
        )
        config = app.state.ai_config_service.get()
        version = str(config.version) if config is not None else "unknown"
        with app.state.database.session() as session:
            session.add(
                AdminAuditRow(
                    id=str(uuid4()),
                    actor=operator.username,
                    action="ai_connection_tested",
                    resource_type="ai_configuration",
                    resource_id="default",
                    change_summary={
                        "changedFields": [],
                        "previousVersion": version,
                        "currentVersion": version,
                        "apiKeyChanged": False,
                    },
                    trace_id=request.state.trace_id,
                    request_id=request.state.trace_id,
                    created_at=_now(),
                )
            )
        return response

    @app.get(
        "/api/v1/admin/ai/interactions",
        response_model=AIInteractionPage,
        operation_id="listAIInteractions",
    )
    def list_ai_interactions(
        _operator: Annotated[Any, Depends(require_role("admin"))],
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ) -> AIInteractionPage:
        with app.state.database.session() as session:
            total = session.query(AIInteractionRow).count()
            rows = list(
                session.scalars(
                    select(AIInteractionRow)
                    .order_by(AIInteractionRow.created_at.desc())
                    .offset(offset)
                    .limit(limit)
                )
            )
        return AIInteractionPage(
            items=[_interaction_response(row) for row in rows],
            total=total,
        )

    @app.get(
        "/api/v1/admin/audit",
        response_model=AdminAuditPage,
        operation_id="listAdminAudit",
    )
    def list_admin_audit(
        _operator: Annotated[Any, Depends(require_role("admin"))],
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ) -> AdminAuditPage:
        with app.state.database.session() as session:
            total = session.query(AdminAuditRow).count()
            rows = list(
                session.scalars(
                    select(AdminAuditRow)
                    .order_by(AdminAuditRow.created_at.desc())
                    .offset(offset)
                    .limit(limit)
                )
            )
        return AdminAuditPage(
            items=[_admin_audit_response(row) for row in rows],
            total=total,
        )

    @app.get("/healthz", response_model=Health, operation_id="healthcheck")
    def healthcheck() -> Health:
        return Health(status="ok", checks={"process": "alive"})

    @app.get("/readyz", response_model=Health, operation_id="readiness")
    def readiness(request: Request) -> Any:
        try:
            app.state.database.check_ready()
        except Exception:
            return JSONResponse(
                status_code=503,
                content=jsonable_encoder(
                    _problem(request, "database_not_ready", "Database readiness check failed")
                ),
            )
        status, message = app.state.catalog.readiness()
        worker_check = check_worker(
            data_dir=data_dir or _default_data_dir(),
            database=app.state.database,
            heartbeat_timeout_seconds=float(os.getenv("WORKER_HEARTBEAT_TIMEOUT_SECONDS", "60")),
        )
        if worker_check["status"] != "ok":
            status = "degraded"
        return Health(
            status=status,
            checks={
                "demo_data": message,
                "database": "available",
                "worker": worker_check["checks"]["worker_heartbeat"],
                "industrial_model": worker_check["checks"]["industrial_model"],
            },
        )

    @app.get("/api/v1/scenarios", response_model=list[Scenario], operation_id="listScenarios")
    def list_scenarios() -> list[Scenario]:
        return app.state.catalog.scenarios

    @app.post("/api/v1/runs", response_model=ReplayRun, status_code=201, operation_id="createRun")
    def create_run(
        request: Request,
        body: CreateRunRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=128),
    ) -> Any:
        scenario = app.state.catalog.get(body.scenario_id)
        if not scenario:
            raise APIError(
                404, "scenario_not_found", "Scenario not found", {"scenarioId": body.scenario_id}
            )
        db: Database = app.state.database
        scope = "create-run"
        payload = body.model_dump(mode="json", by_alias=True)
        try:
            with db.session() as session:
                previous = _idempotent(session, scope, idempotency_key, payload)
                if previous:
                    return JSONResponse(status_code=previous.status_code, content=previous.response)
                run_id = uuid4()
                created_at = _now()
                run_row = ReplayRunRow(
                    id=str(run_id),
                    scenario_id=scenario.id,
                    state="ready",
                    speed=body.speed,
                    current_sample=0,
                    created_at=created_at,
                )
                model_version = (
                    _online_model_version(app.state.catalog.data_dir)
                    if body.inference_mode == "online"
                    else DEGRADED_FALLBACK_MODEL_VERSION
                )
                session.add(run_row)
                inference = RunInferenceStateRow(
                    run_id=str(run_id),
                    mode=body.inference_mode,
                    model_version=model_version,
                )
                session.add(inference)
                _append_stream_message(
                    session,
                    str(run_id),
                    "state",
                    0,
                    {"runId": str(run_id), "state": "ready", "currentSample": 0},
                )
                if body.inference_mode == "template":
                    event_id = uuid4()
                    detail = _fallback_detail(
                        event_id,
                        run_id,
                        scenario,
                        app.state.catalog.event_template(scenario.id),
                    )
                    inference.model_version = detail.model_version
                    session.add(
                        AnomalyEventRow(
                            id=str(event_id),
                            run_id=str(run_id),
                            sample_index=detail.sample_index,
                            severity=detail.severity,
                            state=detail.state,
                            anomaly_score=detail.anomaly_score,
                            detail=detail.model_dump(
                                mode="json", by_alias=True, exclude={"id", "runId"}
                            ),
                        )
                    )
                    _append_stream_message(
                        session,
                        str(run_id),
                        "anomaly_opened",
                        detail.sample_index,
                        {
                            "runId": str(run_id),
                            "eventId": str(event_id),
                            "sampleIndex": detail.sample_index,
                            "diagnosisState": detail.diagnosis_state,
                        },
                    )
                response = _run_response(run_row, inference)
                _save_idempotency(session, scope, idempotency_key, payload, response, 201)
                return response
        except IntegrityError:
            if not idempotency_key:
                raise
            with db.session() as session:
                previous = _idempotent(session, scope, idempotency_key, payload)
                if previous:
                    return JSONResponse(status_code=previous.status_code, content=previous.response)
            raise

    @app.get("/api/v1/runs/{runId}", response_model=ReplayRun, operation_id="getRun")
    def get_run(runId: UUID) -> ReplayRun:
        with app.state.database.session() as session:
            row = session.get(ReplayRunRow, str(runId))
            if not row:
                raise APIError(404, "run_not_found", "Replay run not found")
            inference = session.get(RunInferenceStateRow, str(runId))
            return _run_response(row, inference)

    @app.post("/api/v1/runs/{runId}/control", response_model=ReplayRun, operation_id="controlRun")
    def control_run(
        runId: UUID,
        body: RunControlRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=128),
    ) -> Any:
        scope = f"control-run:{runId}"
        payload = body.model_dump(mode="json", by_alias=True)
        try:
            with app.state.database.session() as session:
                previous = _idempotent(session, scope, idempotency_key, payload)
                if previous:
                    return JSONResponse(status_code=previous.status_code, content=previous.response)
                row = session.get(ReplayRunRow, str(runId))
                if not row:
                    raise APIError(404, "run_not_found", "Replay run not found")
                inference = session.get(RunInferenceStateRow, str(runId))
                if body.action == "play":
                    row.state = "playing"
                elif body.action == "pause":
                    row.state = "paused"
                elif body.action == "restart":
                    row.state, row.current_sample = "ready", 0
                    if inference is not None and inference.mode == "online":
                        session.execute(
                            delete(RunStreamMessageRow).where(
                                RunStreamMessageRow.run_id == str(runId)
                            )
                        )
                        session.execute(
                            delete(AnomalyEventRow).where(AnomalyEventRow.run_id == str(runId))
                        )
                        inference.failure_reason = None
                        inference.worker_id = None
                        inference.heartbeat_at = None
                elif body.action == "seek":
                    if body.sample_index is None:
                        raise APIError(
                            422, "sample_index_required", "sampleIndex is required for seek"
                        )
                    scenario = app.state.catalog.get(row.scenario_id)
                    if scenario and body.sample_index >= scenario.sample_count:
                        raise APIError(
                            422,
                            "sample_index_out_of_range",
                            "sampleIndex exceeds scenario sample count",
                        )
                    row.current_sample = body.sample_index
                if body.speed is not None:
                    row.speed = body.speed
                _append_stream_message(
                    session,
                    str(runId),
                    "state",
                    row.current_sample,
                    {
                        "runId": str(runId),
                        "state": row.state,
                        "currentSample": row.current_sample,
                    },
                )
                response = _run_response(row, inference)
                _save_idempotency(session, scope, idempotency_key, payload, response, 200)
                return response
        except IntegrityError:
            if not idempotency_key:
                raise
            with app.state.database.session() as session:
                previous = _idempotent(session, scope, idempotency_key, payload)
                if previous:
                    return JSONResponse(status_code=previous.status_code, content=previous.response)
            raise

    @app.get("/api/v1/runs/{runId}/stream", operation_id="streamRun")
    def stream_run(
        runId: UUID,
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    ) -> StreamingResponse:
        if last_event_id is None:
            cursor = 0
        elif not last_event_id.isdecimal():
            raise APIError(
                400,
                "invalid_last_event_id",
                "Last-Event-ID must be a non-negative integer",
            )
        else:
            cursor = int(last_event_id)
        with app.state.database.session() as session:
            run = session.get(ReplayRunRow, str(runId))
            if not run:
                raise APIError(404, "run_not_found", "Replay run not found")

        async def event_stream():
            durable_cursor = cursor
            heartbeat_number = 0
            while app.state.sse_heartbeat_count is None or (
                heartbeat_number < app.state.sse_heartbeat_count
            ):
                with app.state.database.session() as session:
                    messages = list(
                        session.scalars(
                            select(RunStreamMessageRow)
                            .where(
                                RunStreamMessageRow.run_id == str(runId),
                                RunStreamMessageRow.id > durable_cursor,
                            )
                            .order_by(RunStreamMessageRow.id)
                        )
                    )
                if messages:
                    for message in messages:
                        durable_cursor = message.id
                        yield _sse_frame(
                            message.id,
                            message.event_type,
                            _stream_payload(message),
                        )
                    continue
                await asyncio.sleep(app.state.sse_heartbeat_interval_seconds)
                heartbeat_number += 1
                heartbeat_payload = {
                    "type": "heartbeat",
                    "sequence": durable_cursor,
                    "runId": str(runId),
                    "emittedAt": _now().replace(tzinfo=UTC),
                }
                encoded = json.dumps(
                    jsonable_encoder(heartbeat_payload),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                yield f"event: heartbeat\ndata: {encoded}\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get(
        "/api/v1/runs/{runId}/events",
        response_model=list[AnomalyEvent],
        operation_id="listRunEvents",
    )
    def list_run_events(runId: UUID) -> list[AnomalyEvent]:
        with app.state.database.session() as session:
            if not session.get(ReplayRunRow, str(runId)):
                raise APIError(404, "run_not_found", "Replay run not found")
            rows = session.scalars(
                select(AnomalyEventRow).where(AnomalyEventRow.run_id == str(runId))
            ).all()
            return [_event_response(row) for row in rows]

    @app.get("/api/v1/events/{eventId}", response_model=EventDetail, operation_id="getEvent")
    def get_event(eventId: UUID) -> EventDetail:
        with app.state.database.session() as session:
            row = session.get(AnomalyEventRow, str(eventId))
            if not row:
                raise APIError(404, "event_not_found", "Anomaly event not found")
            return _event_detail(row)

    @app.post(
        "/api/v1/events/{eventId}/ask",
        response_model=AIAnswer,
        operation_id="askEvent",
    )
    def ask_event(
        request: Request,
        eventId: UUID,
        body: AskEventRequest,
        operator: Annotated[Any, Depends(require_role("operator"))],
    ) -> AIAnswer:
        with app.state.database.session() as session:
            row = session.get(AnomalyEventRow, str(eventId))
            if row is None:
                raise APIError(404, "event_not_found", "Anomaly event not found")
            detail = _event_detail(row)
        try:
            settings = runtime_llm_settings()
        except EncryptionKeyError:
            settings = LLMSettings(provider="disabled")
        result = ExplanationEnhancer(settings).enhance(
            detail.model_dump(mode="json", by_alias=True),
            body.question,
            trace_id=request.state.trace_id,
        )
        interaction_id = uuid4()
        created_at = _now()
        with app.state.database.session() as session:
            session.add(
                AIInteractionRow(
                    id=str(interaction_id),
                    event_id=str(eventId),
                    operator=operator.username,
                    question=body.question,
                    answer=result.answer,
                    evidence_refs=list(result.evidence_refs),
                    mode=result.mode,
                    model=result.model,
                    latency_ms=result.latency_ms,
                    trace_id=result.trace_id,
                    created_at=created_at,
                )
            )
        return AIAnswer.model_validate(result.to_dict())

    @app.post(
        "/api/v1/events/{eventId}/decision",
        response_model=DecisionRecord,
        status_code=201,
        operation_id="decideEvent",
    )
    def decide_event(
        request: Request,
        eventId: UUID,
        body: DecisionRequest,
        operator: Annotated[Any, Depends(require_role("operator"))],
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=128),
    ) -> Any:
        if (
            body.decision in {"confirm", "reject"}
            and ROLE_ORDER[operator.role] < ROLE_ORDER["shift_lead"]
        ):
            raise APIError(
                403,
                "role_forbidden",
                "Confirm/reject requires a shift lead; operators may only escalate.",
            )
        scope = f"decision:{eventId}"
        payload = body.model_dump(mode="json", by_alias=True)
        try:
            with app.state.database.session() as session:
                previous = _idempotent(session, scope, idempotency_key, payload)
                if previous:
                    return JSONResponse(status_code=previous.status_code, content=previous.response)
                event = session.get(AnomalyEventRow, str(eventId))
                if not event:
                    raise APIError(404, "event_not_found", "Anomaly event not found")
                detail = _event_detail(event)
                record_id = uuid4()
                created_at = _now()
                actor_label = f"{operator.display_name} ({operator.username})"
                record = DecisionRecord(
                    id=record_id,
                    event_id=eventId,
                    decision=body.decision,
                    operator_name=actor_label,
                    operator_role=operator.role,
                    note=body.note,
                    created_at=created_at.replace(tzinfo=UTC),
                    model_version=detail.model_version,
                    trace_id=request.state.trace_id,
                )
                session.add(
                    DecisionRow(
                        id=str(record_id),
                        event_id=str(eventId),
                        decision=body.decision,
                        operator_name=actor_label,
                        operator_role=operator.role,
                        note=body.note,
                        created_at=created_at,
                        model_version=detail.model_version,
                        trace_id=request.state.trace_id,
                    )
                )
                session.add(
                    AuditRow(
                        id=str(uuid4()),
                        event_id=str(eventId),
                        record_id=str(record_id),
                        action="human_decision",
                        actor=actor_label,
                        payload={
                            **record.model_dump(mode="json", by_alias=True),
                            "decisionMethod": body.decision_method,
                        },
                        trace_id=request.state.trace_id,
                        created_at=created_at,
                    )
                )
                event.state = {
                    "confirm": "confirmed",
                    "reject": "rejected",
                    "escalate": "escalated",
                }[body.decision]
                _save_idempotency(session, scope, idempotency_key, payload, record, 201)
                return record
        except IntegrityError:
            if not idempotency_key:
                raise
            with app.state.database.session() as session:
                previous = _idempotent(session, scope, idempotency_key, payload)
                if previous:
                    return JSONResponse(status_code=previous.status_code, content=previous.response)
            raise

    @app.get("/api/v1/records/{recordId}", response_model=DecisionRecord, operation_id="getRecord")
    def get_record(recordId: UUID) -> DecisionRecord:
        with app.state.database.session() as session:
            row = session.get(DecisionRow, str(recordId))
            if not row:
                raise APIError(404, "record_not_found", "Decision record not found")
            return DecisionRecord(
                id=UUID(row.id),
                event_id=UUID(row.event_id),
                decision=row.decision,
                operator_name=row.operator_name,
                operator_role=row.operator_role,
                note=row.note,
                created_at=row.created_at.replace(tzinfo=UTC),
                model_version=row.model_version,
                trace_id=row.trace_id,
            )

    def custom_openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        # Problem is emitted by exception handlers rather than a response model,
        # so register it explicitly in the frozen contract surface.
        schema.setdefault("components", {}).setdefault("schemas", {})["Problem"] = {
            "type": "object",
            "required": ["code", "message", "traceId"],
            "properties": {
                "code": {"type": "string"},
                "message": {"type": "string"},
                "details": {"type": "object", "additionalProperties": True},
                "traceId": {"type": "string"},
            },
        }
        schema["components"].setdefault("responses", {})["Problem"] = {
            "description": "Request could not be completed.",
            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Problem"}}},
        }
        schema["servers"] = [{"url": "/"}]
        expected_responses: dict[Any, set[str]] = {
            "/healthz": {"200", "400"},
            "/readyz": {"200", "400", "503"},
            "/api/v1/scenarios": {"200", "400"},
            "/api/v1/auth/login": {"200", "401", "422"},
            "/api/v1/auth/me": {"200", "401"},
            "/api/v1/runs": {"201", "404", "409", "422"},
            "/api/v1/runs/{runId}": {"200", "404"},
            "/api/v1/runs/{runId}/control": {"200", "404", "409", "422"},
            "/api/v1/runs/{runId}/stream": {"200", "400", "404"},
            "/api/v1/runs/{runId}/events": {"200", "404"},
            "/api/v1/events/{eventId}": {"200", "404"},
            "/api/v1/events/{eventId}/ask": {"200", "401", "404", "422"},
            "/api/v1/events/{eventId}/decision": {"201", "401", "403", "404", "409", "422"},
            "/api/v1/records/{recordId}": {"200", "404"},
            "/api/v1/admin/overview": {"200", "401", "403"},
            "/api/v1/admin/ai/status": {"200", "401", "403"},
            ("/api/v1/admin/ai/config", "get"): {"200", "401", "403"},
            ("/api/v1/admin/ai/config", "put"): {
                "200",
                "401",
                "403",
                "409",
                "422",
            },
            "/api/v1/admin/ai/test": {"200", "401", "403", "422"},
            "/api/v1/admin/ai/interactions": {"200", "401", "403"},
            "/api/v1/admin/audit": {"200", "401", "403"},
        }
        for path, methods in schema["paths"].items():
            for method, operation in methods.items():
                expected = expected_responses.get((path, method), expected_responses.get(path))
                if expected is None:
                    continue
                generated = operation.get("responses", {})
                operation["responses"] = {
                    code: generated.get(
                        code,
                        {"$ref": "#/components/responses/Problem"},
                    )
                    for code in expected
                }
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi  # type: ignore[method-assign]

    return app


app = create_app()
