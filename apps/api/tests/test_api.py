import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
import yaml
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from process_copilot_api.auth import token_secret
from process_copilot_api.catalog import DataCatalog
from process_copilot_api.crypto import decrypt_api_key
from process_copilot_api.db import (
    AIConfigurationRow,
    AnomalyEventRow,
    ReplayRunRow,
    RunInferenceStateRow,
    RunStreamMessageRow,
)
from process_copilot_api.main import create_app
from process_copilot_api.worker import inspect_processed_data


@pytest.fixture()
def client(tmp_path: Path):
    data_dir = tmp_path / "processed"
    data_dir.mkdir()
    (data_dir / "manifest.json").write_text(
        json.dumps(
            {
                "scenarios": [
                    {
                        "id": "tep-fault-05",
                        "name": "冷却水流量偏移",
                        "description": "公开仿真故障场景",
                        "faultId": 5,
                        "sampleCount": 500,
                        "faultOnsetSample": 120,
                        "sourceLabel": "Tennessee Eastman Process public simulation",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_dir=data_dir,
        sse_heartbeat_interval_seconds=0.001,
        sse_heartbeat_count=3,
    )
    with TestClient(app) as test_client:
        yield test_client


def login_token(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


@pytest.fixture()
def lead_headers(client: TestClient):
    token = login_token(client, "shift-lead", "demo-lead-2026")
    return {"Authorization": f"Bearer {token}"}


def test_login_issues_token_and_me_reports_role(client: TestClient):
    token = login_token(client, "operator-01", "demo-op-2026")
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "operator"

    bad = client.post(
        "/api/v1/auth/login", json={"username": "operator-01", "password": "wrong"}
    )
    assert bad.status_code == 401
    assert bad.json()["code"] == "invalid_credentials"

    anonymous = client.get("/api/v1/auth/me")
    assert anonymous.status_code == 401
    assert anonymous.json()["code"] == "missing_token"


def test_admin_demo_account_exists_without_registration(client: TestClient):
    token = login_token(client, "system-admin", "demo-admin-2026")
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert me.status_code == 200
    assert me.json() == {
        "username": "system-admin",
        "role": "admin",
        "displayName": "系统管理员",
    }
    assert client.post(
        "/api/v1/auth/register",
        json={"username": "new-user", "password": "not-allowed"},
    ).status_code == 404


def test_production_rejects_missing_or_weak_operator_token_secret(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("OPERATOR_TOKEN_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="OPERATOR_TOKEN_SECRET"):
        token_secret()

    monkeypatch.setenv("OPERATOR_TOKEN_SECRET", "too-short")
    with pytest.raises(RuntimeError, match="OPERATOR_TOKEN_SECRET"):
        token_secret()

    strong = "operator-token-secret-for-production-2026"
    monkeypatch.setenv("OPERATOR_TOKEN_SECRET", strong)
    assert token_secret() == strong


def test_decision_requires_authentication_and_role(client: TestClient):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    event = client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
    url = f"/api/v1/events/{event['id']}/decision"

    anonymous = client.post(url, json={"decision": "confirm", "note": "确认"})
    assert anonymous.status_code == 401

    op_token = login_token(client, "operator-01", "demo-op-2026")
    operator_forbidden = client.post(
        url,
        json={"decision": "confirm", "note": "确认"},
        headers={"Authorization": f"Bearer {op_token}"},
    )
    assert operator_forbidden.status_code == 403
    assert operator_forbidden.json()["code"] == "role_forbidden"

    escalated = client.post(
        url,
        json={"decision": "escalate", "note": "上报班长"},
        headers={"Authorization": f"Bearer {op_token}"},
    )
    assert escalated.status_code == 201
    assert escalated.json()["operatorRole"] == "operator"

    admin_token = login_token(client, "system-admin", "demo-admin-2026")
    admin_confirmed = client.post(
        url,
        json={"decision": "confirm", "note": "管理员复核确认"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert admin_confirmed.status_code == 201
    assert admin_confirmed.json()["operatorRole"] == "admin"


def test_control_proposal_runs_real_shadow_checks_but_never_sends(client: TestClient):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    event = client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
    url = f"/api/v1/events/{event['id']}/control-proposals"

    anonymous = client.post(url, json={"actionDraft": "提高监视频率"})
    assert anonymous.status_code == 401

    operator_token = login_token(client, "operator-01", "demo-op-2026")
    headers = {
        "Authorization": f"Bearer {operator_token}",
        "Idempotency-Key": "shadow-proposal-1",
    }
    created = client.post(
        url,
        headers=headers,
        json={
            "actionDraft": "保持当前控制策略，提高关键变量监视频率并上报班长复核。",
            "sourceTraceId": "trace-ai-answer-1",
        },
    )

    assert created.status_code == 201, created.text
    proposal = created.json()
    assert proposal["eventId"] == event["id"]
    assert proposal["executionMode"] == "shadow"
    assert proposal["state"] == "blocked_demo_boundary"
    assert proposal["sent"] is False
    assert proposal["requestedBy"] == "operator-01"
    assert proposal["sourceTraceId"] == "trace-ai-answer-1"
    assert [check["status"] for check in proposal["checks"]] == [
        "passed",
        "passed",
        "not_configured",
        "not_connected",
        "disabled",
    ]
    assert proposal["checks"][-1]["name"] == "控制网关"

    repeated = client.post(
        url,
        headers=headers,
        json={
            "actionDraft": "保持当前控制策略，提高关键变量监视频率并上报班长复核。",
            "sourceTraceId": "trace-ai-answer-1",
        },
    )
    assert repeated.status_code == 201
    assert repeated.json()["id"] == proposal["id"]

    listed = client.get(url, headers={"Authorization": f"Bearer {operator_token}"})
    assert listed.status_code == 200
    assert listed.json() == [proposal]


def test_control_proposal_rejects_executable_control_coordinates(client: TestClient):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    event = client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
    operator_token = login_token(client, "operator-01", "demo-op-2026")

    response = client.post(
        f"/api/v1/events/{event['id']}/control-proposals",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={"actionDraft": "向 PLC 寄存器 0x10 写入 1"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "unsafe_control_draft"


def test_health_and_readiness_expose_trace_id(client: TestClient):
    health = client.get("/healthz", headers={"X-Trace-ID": "trace-health"})
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.headers["X-Trace-ID"] == "trace-health"

    ready = client.get("/readyz")
    assert ready.status_code == 200
    assert ready.json()["status"] in {"ok", "degraded"}


def test_scenarios_are_loaded_from_demo_manifest(client: TestClient):
    response = client.get("/api/v1/scenarios")
    assert response.status_code == 200
    assert response.json()[0]["id"] == "tep-fault-05"
    assert response.json()[0]["sourceLabel"] == "Tennessee Eastman Process public simulation"


def test_create_app_runs_ready_database(tmp_path: Path):
    data_dir = tmp_path / "processed"
    data_dir.mkdir()
    app = create_app(database_url=f"sqlite:///{tmp_path / 'api.db'}", data_dir=data_dir)
    assert app.state.database.check_ready() is None


def test_create_app_bootstraps_ai_config_from_llm_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    for name in (
        "AI_ENABLED",
        "AI_PROVIDER",
        "AI_BASE_URL",
        "AI_MODEL",
        "AI_API_KEY",
        "AI_TIMEOUT",
        "AI_MAX_TOKENS",
        "AI_TEMPERATURE",
        "AI_PROMPT_VERSION",
        "AI_FALLBACK_MODE",
        "AI_CONFIG_VERSION",
        "APP_ENV",
        "AI_ALLOWED_HOSTS",
        "LLM_ALLOWED_HOSTS",
    ):
        monkeypatch.delenv(name, raising=False)
    encryption_key = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("AI_CONFIG_ENCRYPTION_KEY", encryption_key)
    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("LLM_MODEL", "sentinel-explainer")
    monkeypatch.setenv("LLM_API_KEY", "runtime-secret")
    monkeypatch.setenv("LLM_ALLOWED_HOSTS", "llm.example.test")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "12")
    monkeypatch.setenv("LLM_MAX_TOKENS", "900")
    monkeypatch.setenv("LLM_PROMPT_VERSION", "event-copilot-v02")

    data_dir = tmp_path / "processed"
    data_dir.mkdir()
    database_url = f"sqlite:///{tmp_path / 'api.db'}"
    app = create_app(database_url=database_url, data_dir=data_dir)

    with app.state.database.session() as session:
        row = session.get(AIConfigurationRow, "default")
        assert row is not None
        assert row.enabled is True
        assert row.provider == "openai-compatible"
        assert row.base_url == "https://llm.example.test/v1"
        assert row.model == "sentinel-explainer"
        assert row.api_key_ciphertext is not None
        stored_ciphertext = row.api_key_ciphertext
        assert stored_ciphertext != "runtime-secret"
        assert "runtime-secret" not in stored_ciphertext
        assert decrypt_api_key(stored_ciphertext) == "runtime-secret"

    with TestClient(app) as test_client:
        admin_token = login_token(test_client, "system-admin", "demo-admin-2026")
        response = test_client.get(
            "/api/v1/admin/ai/config",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["apiKeyConfigured"] is True
    serialized_payload = json.dumps(payload)
    assert "apiKey" not in payload
    assert "runtime-secret" not in serialized_payload
    assert stored_ciphertext not in serialized_payload

    monkeypatch.setenv("LLM_MODEL", "should-not-overwrite")
    monkeypatch.setenv("LLM_API_KEY", "replacement-secret")
    restarted = create_app(database_url=database_url, data_dir=data_dir)
    with restarted.state.database.session() as session:
        restarted_row = session.get(AIConfigurationRow, "default")
        assert restarted_row is not None
        assert restarted_row.model == "sentinel-explainer"
        assert decrypt_api_key(restarted_row.api_key_ciphertext) == "runtime-secret"


def test_catalog_reads_agent_generated_scenario_and_event_template(tmp_path: Path):
    scenario_dir = tmp_path / "scenarios" / "tep-f01-feed-ratio-step"
    scenario_dir.mkdir(parents=True)
    (scenario_dir / "scenario.json").write_text(
        json.dumps(
            {
                "id": "tep-f01-feed-ratio-step",
                "name": "Feed composition step deviation",
                "faultId": 1,
                "sampleCount": 960,
                "faultOnsetSample": 160,
                "sourceLabel": "Tennessee Eastman Process public simulation",
            }
        ),
        encoding="utf-8",
    )
    (scenario_dir / "event-template.json").write_text(
        json.dumps({"sampleIndex": 161, "anomalyScore": 1.2}), encoding="utf-8"
    )
    catalog = DataCatalog(tmp_path)
    assert catalog.get("tep-f01-feed-ratio-step").sample_count == 960
    assert catalog.event_template("tep-f01-feed-ratio-step")["sampleIndex"] == 161


def test_catalog_accepts_allowlisted_wastewater_prediction_scenario(tmp_path: Path):
    scenario_dir = tmp_path / "scenarios" / "uci-wtp-effluent"
    scenario_dir.mkdir(parents=True)
    (scenario_dir / "scenario.json").write_text(
        json.dumps(
            {
                "id": "uci-wtp-effluent",
                "name": "出水风险预判",
                "description": "基于当前过程变量预测下一化验周期的出水 COD 风险。",
                "faultId": 0,
                "sampleCount": 156,
                "faultOnsetSample": 86,
                "sourceLabel": "UCI Water Treatment Plant public sensor data",
                "domain": "wastewater",
                "modelFamily": "uci-wtp-pca-softsensor",
                "sampleIntervalSeconds": 86400,
                "recommendedInferenceMode": "template",
            }
        ),
        encoding="utf-8",
    )

    catalog = DataCatalog(tmp_path)

    scenario = catalog.get("uci-wtp-effluent")
    assert scenario is not None
    assert scenario.domain == "wastewater"
    assert scenario.model_family == "uci-wtp-pca-softsensor"
    assert scenario.sample_interval_seconds == 86400
    assert scenario.recommended_inference_mode == "template"
    assert catalog.readiness() == ("ok", "manifest loaded")


def test_wastewater_event_preserves_prediction_evidence(tmp_path: Path):
    data_dir = tmp_path / "processed"
    scenario_dir = data_dir / "scenarios" / "uci-wtp-effluent"
    scenario_dir.mkdir(parents=True)
    scenario = {
        "id": "uci-wtp-effluent",
        "name": "出水风险预判",
        "faultId": 0,
        "sampleCount": 156,
        "faultOnsetSample": 86,
        "sourceLabel": "UCI Water Treatment Plant public sensor data",
        "domain": "wastewater",
        "modelFamily": "uci-wtp-pca-softsensor",
        "sampleIntervalSeconds": 86400,
        "recommendedInferenceMode": "template",
    }
    (scenario_dir / "scenario.json").write_text(json.dumps(scenario), encoding="utf-8")
    candidate = {"faultId": 0, "label": "出水质量风险", "probability": 0.82}
    evidence = {
        "variableId": "DQO-D",
        "variableName": "二沉池入口化学需氧量",
        "unit": "mg/L",
        "contribution": 0.8,
        "direction": "up",
        "summary": "连续高于训练期中位水平",
        "values": [198.0, 206.0, 217.0],
    }
    template = {
        "sampleIndex": 86,
        "detectionSample": 86,
        "diagnosisSample": 87,
        "diagnosisDelaySamples": 1,
        "diagnosisState": "updated",
        "diagnosisAnomalyScore": 0.82,
        "anomalyLatched": True,
        "anomalyScore": 0.82,
        "initialCandidates": [candidate],
        "candidates": [candidate],
        "evidence": [
            evidence,
            {**evidence, "variableId": "SS-D", "variableName": "二沉池入口悬浮物"},
            {**evidence, "variableId": "PH-D", "variableName": "二沉池入口 pH"},
        ],
        "recommendation": {
            "mode": "template",
            "risk": "下一化验周期出水 COD 进入历史高位区间",
            "checks": ["核对二沉池入口负荷与取样时间"],
            "actions": ["由操作员确认是否升级复核"],
            "safetyBoundary": "Read-only advice. No automatic control write-back.",
        },
        "prediction": {
            "targetId": "DQO-S",
            "targetName": "出水化学需氧量",
            "unit": "mg/L",
            "horizonSamples": 1,
            "horizonLabel": "下一化验周期",
            "predictedValue": 92.4,
            "observedValue": None,
            "historicalHighBoundary": 88.0,
            "uncertaintyMae": 6.2,
            "lowerBound": 86.2,
            "upperBound": 98.6,
            "riskLevel": "elevated",
            "boundaryBasis": "训练期出水 COD 第 95 百分位，不是法规排放限值。",
        },
        "modelVersion": "uci-wtp-pca-softsensor-v1",
        "dataSourceDisclosure": "Public UCI wastewater sensor data, not real Guizhou plant data.",
    }
    (scenario_dir / "event-template.json").write_text(json.dumps(template), encoding="utf-8")
    app = create_app(database_url=f"sqlite:///{tmp_path / 'api.db'}", data_dir=data_dir)

    with TestClient(app) as test_client:
        run = test_client.post("/api/v1/runs", json={"scenarioId": scenario["id"]}).json()
        event = test_client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
        response = test_client.get(f"/api/v1/events/{event['id']}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["diagnosisDelaySamples"] == 1
    assert payload["prediction"]["targetId"] == "DQO-S"
    assert payload["prediction"]["riskLevel"] == "elevated"
    assert "不是法规排放限值" in payload["prediction"]["boundaryBasis"]
    assert payload["dataSourceDisclosure"] == (
        "Public UCI wastewater sensor data, not real Guizhou plant data."
    )


def test_event_detail_preserves_two_stage_generated_template(tmp_path: Path):
    data_dir = tmp_path / "processed"
    scenario_dir = data_dir / "scenarios" / "tep-f01-feed-ratio-step"
    scenario_dir.mkdir(parents=True)
    scenario = {
        "id": "tep-f01-feed-ratio-step",
        "name": "Feed composition step deviation",
        "faultId": 1,
        "sampleCount": 960,
        "faultOnsetSample": 160,
        "sourceLabel": "Tennessee Eastman Process public simulation",
    }
    (scenario_dir / "scenario.json").write_text(json.dumps(scenario), encoding="utf-8")
    candidate = {"faultId": 1, "label": "Feed composition", "probability": 0.8}
    evidence = {
        "variableId": "XMEAS(1)",
        "variableName": "Feed flow",
        "unit": "%",
        "contribution": 0.8,
        "direction": "up",
        "summary": "Above baseline",
        "values": [0.1, 0.2],
    }
    template = {
        "sampleIndex": 100,
        "detectionSample": 100,
        "diagnosisSample": 120,
        "diagnosisDelaySamples": 20,
        "diagnosisState": "updated",
        "diagnosisAnomalyScore": 0.8,
        "anomalyLatched": True,
        "anomalyScore": 1.2,
        "initialCandidates": [candidate],
        "candidates": [candidate],
        "evidence": [
            evidence,
            {**evidence, "variableId": "XMEAS(2)"},
            {**evidence, "variableId": "XMV(1)"},
        ],
        "recommendation": {
            "mode": "template",
            "risk": "Review",
            "checks": ["Check trend"],
            "actions": ["Escalate if confirmed"],
            "safetyBoundary": "Read-only advice. No automatic control write-back.",
        },
        "modelVersion": "tep-test-v1",
        "dataSourceDisclosure": "Public simulation data, not real Guizhou plant data.",
    }
    (scenario_dir / "event-template.json").write_text(json.dumps(template), encoding="utf-8")
    app = create_app(database_url=f"sqlite:///{tmp_path / 'api.db'}", data_dir=data_dir)
    with TestClient(app) as test_client:
        run = test_client.post("/api/v1/runs", json={"scenarioId": scenario["id"]}).json()
        event = test_client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
        response = test_client.get(f"/api/v1/events/{event['id']}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sampleIndex"] == payload["detectionSample"] == 100
    assert payload["diagnosisSample"] == 120
    assert payload["diagnosisDelaySamples"] == 20
    assert payload["diagnosisState"] == "updated"
    assert payload["anomalyLatched"] is True
    assert payload["initialCandidates"]
    assert payload["candidates"] or payload["diagnosisState"] == "updated"


def test_development_fallback_also_satisfies_two_stage_event_contract(tmp_path: Path):
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'fallback.db'}",
        data_dir=tmp_path / "missing",
    )
    with TestClient(app) as test_client:
        scenario = test_client.get("/api/v1/scenarios").json()[0]
        run = test_client.post("/api/v1/runs", json={"scenarioId": scenario["id"]}).json()
        event = test_client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
        response = test_client.get(f"/api/v1/events/{event['id']}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["detectionSample"] == payload["sampleIndex"]
    assert payload["diagnosisSample"] >= payload["detectionSample"]
    assert payload["diagnosisDelaySamples"] == 20
    assert payload["diagnosisState"] in {"pending", "provisional", "updated"}
    assert payload["anomalyLatched"] is True


def test_missing_event_template_marks_hardcoded_detail_as_degraded(tmp_path: Path):
    data_dir = tmp_path / "processed"
    scenario_dir = data_dir / "scenarios" / "tep-f01-feed-ratio-step"
    scenario_dir.mkdir(parents=True)
    scenario = {
        "id": "tep-f01-feed-ratio-step",
        "name": "Feed composition step deviation",
        "faultId": 1,
        "sampleCount": 960,
        "faultOnsetSample": 160,
        "sourceLabel": "Tennessee Eastman Process public simulation",
    }
    (scenario_dir / "scenario.json").write_text(json.dumps(scenario), encoding="utf-8")
    (scenario_dir / "event-template.json").write_text("{not-json", encoding="utf-8")
    app = create_app(database_url=f"sqlite:///{tmp_path / 'api.db'}", data_dir=data_dir)

    with TestClient(app) as test_client:
        run = test_client.post("/api/v1/runs", json={"scenarioId": scenario["id"]}).json()
        event_id = test_client.get(f"/api/v1/runs/{run['id']}/events").json()[0]["id"]
        response = test_client.get(f"/api/v1/events/{event_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommendation"]["mode"] == "degraded"
    assert "degraded" in payload["modelVersion"]
    assert "演示降级" in payload["recommendation"]["risk"]


def test_catalog_aggregates_all_generated_scenario_directories(tmp_path: Path):
    for fault_id in (1, 6, 13):
        scenario_id = f"tep-f{fault_id:02d}"
        scenario_dir = tmp_path / "scenarios" / scenario_id
        scenario_dir.mkdir(parents=True)
        (scenario_dir / "scenario.json").write_text(
            json.dumps(
                {
                    "id": scenario_id,
                    "name": f"Fault {fault_id}",
                    "faultId": fault_id,
                    "sampleCount": 960,
                    "faultOnsetSample": 160,
                    "sourceLabel": "Tennessee Eastman Process public simulation",
                }
            ),
            encoding="utf-8",
        )
        (scenario_dir / "event-template.json").write_text(
            json.dumps({"sampleIndex": 160 + fault_id}),
            encoding="utf-8",
        )

    catalog = DataCatalog(tmp_path)

    assert [scenario.id for scenario in catalog.scenarios] == ["tep-f01", "tep-f06", "tep-f13"]
    assert catalog.event_template("tep-f06")["sampleIndex"] == 166


def test_worker_inspects_processed_scenarios_and_models(tmp_path: Path):
    scenario_dir = tmp_path / "scenarios" / "tep-f01-feed-ratio-step"
    scenario_dir.mkdir(parents=True)
    (scenario_dir / "scenario.json").write_text(
        json.dumps(
            {
                "id": "tep-f01-feed-ratio-step",
                "name": "Feed composition step deviation",
                "faultId": 1,
                "sampleCount": 960,
                "faultOnsetSample": 160,
                "sourceLabel": "Tennessee Eastman Process public simulation",
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "model_manifest.json").write_text("{}", encoding="utf-8")
    snapshot = inspect_processed_data(tmp_path)
    assert snapshot["scenarioCount"] == 1
    assert snapshot["modelReady"] is True


def test_create_run_is_idempotent(client: TestClient):
    request = {"scenarioId": "tep-fault-05", "speed": 5}
    first = client.post("/api/v1/runs", json=request, headers={"Idempotency-Key": "run-1"})
    second = client.post("/api/v1/runs", json=request, headers={"Idempotency-Key": "run-1"})
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json() == second.json()
    assert first.json()["state"] == "ready"
    assert first.json()["speed"] == 5


def test_idempotency_rejects_same_key_with_different_request(client: TestClient, lead_headers):
    first = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "speed": 5},
        headers={"Idempotency-Key": "conflict-run"},
    )
    conflict = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "speed": 20},
        headers={"Idempotency-Key": "conflict-run"},
    )
    assert first.status_code == 201
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "idempotency_conflict"

    run_id = first.json()["id"]
    played = client.post(
        f"/api/v1/runs/{run_id}/control",
        json={"action": "play"},
        headers={"Idempotency-Key": "conflict-control"},
    )
    control_conflict = client.post(
        f"/api/v1/runs/{run_id}/control",
        json={"action": "pause"},
        headers={"Idempotency-Key": "conflict-control"},
    )
    assert played.status_code == 200
    assert control_conflict.status_code == 409

    event_id = client.get(f"/api/v1/runs/{run_id}/events").json()[0]["id"]
    decided = client.post(
        f"/api/v1/events/{event_id}/decision",
        json={"decision": "confirm", "note": "确认"},
        headers={"Idempotency-Key": "conflict-decision", **lead_headers},
    )
    decision_conflict = client.post(
        f"/api/v1/events/{event_id}/decision",
        json={"decision": "reject", "note": "误报"},
        headers={"Idempotency-Key": "conflict-decision", **lead_headers},
    )
    assert decided.status_code == 201
    assert decision_conflict.status_code == 409


def test_concurrent_same_idempotency_key_returns_one_run(client: TestClient):
    def submit():
        with TestClient(client.app) as concurrent_client:
            return concurrent_client.post(
                "/api/v1/runs",
                json={"scenarioId": "tep-fault-05", "speed": 10},
                headers={"Idempotency-Key": "concurrent-run"},
            )

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(lambda _: submit(), range(4)))
    assert {response.status_code for response in responses} == {201}
    assert len({response.json()["id"] for response in responses}) == 1


def test_concurrent_control_and_decision_idempotency_are_replayed(client: TestClient, lead_headers):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    run_id = run["id"]

    def control():
        with TestClient(client.app) as concurrent_client:
            return concurrent_client.post(
                f"/api/v1/runs/{run_id}/control",
                json={"action": "play"},
                headers={"Idempotency-Key": "concurrent-control"},
            )

    with ThreadPoolExecutor(max_workers=4) as executor:
        controls = list(executor.map(lambda _: control(), range(4)))
    assert {response.status_code for response in controls} == {200}
    assert len({json.dumps(response.json(), sort_keys=True) for response in controls}) == 1

    event_id = client.get(f"/api/v1/runs/{run_id}/events").json()[0]["id"]

    def decision():
        with TestClient(client.app) as concurrent_client:
            return concurrent_client.post(
                f"/api/v1/events/{event_id}/decision",
                json={"decision": "confirm", "note": "确认"},
                headers={"Idempotency-Key": "concurrent-decision", **lead_headers},
            )

    with ThreadPoolExecutor(max_workers=4) as executor:
        decisions = list(executor.map(lambda _: decision(), range(4)))
    assert {response.status_code for response in decisions} == {201}
    assert len({response.json()["id"] for response in decisions}) == 1


def test_control_and_sse_last_event_id_replay(client: TestClient):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    run_id = run["id"]
    controlled = client.post(
        f"/api/v1/runs/{run_id}/control",
        json={"action": "play", "speed": 10},
        headers={"Idempotency-Key": "control-1"},
    )
    assert controlled.status_code == 200
    assert controlled.json()["state"] == "playing"

    stream = client.get(f"/api/v1/runs/{run_id}/stream")
    assert stream.status_code == 200
    assert "event: state" in stream.text
    assert "event: heartbeat" in stream.text

    resumed = client.get(
        f"/api/v1/runs/{run_id}/stream",
        headers={"Last-Event-ID": "1"},
    )
    assert resumed.status_code == 200
    assert "event: anomaly_opened" in resumed.text
    assert "event: state" in resumed.text
    assert '"sequence":1' not in resumed.text


def test_online_run_freezes_mode_and_waits_for_worker_generated_events(client: TestClient):
    created = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "online"},
    )

    assert created.status_code == 201
    assert created.json()["inferenceMode"] == "online"
    assert created.json()["modelVersion"]
    assert client.get(f"/api/v1/runs/{created.json()['id']}/events").json() == []

    with client.app.state.database.session() as session:
        inference = session.get(RunInferenceStateRow, created.json()["id"])
        assert inference is not None
        assert inference.mode == "online"

    fetched = client.get(f"/api/v1/runs/{created.json()['id']}")
    assert fetched.json()["inferenceMode"] == "online"


def test_event_queue_prioritizes_active_event_over_auto_resolved_transient(client: TestClient):
    run = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "online"},
    ).json()
    with client.app.state.database.session() as session:
        session.add_all(
            [
                AnomalyEventRow(
                    id=str(uuid4()),
                    run_id=run["id"],
                    sample_index=51,
                    severity="warning",
                    state="resolved",
                    anomaly_score=1.1,
                    detail={},
                ),
                AnomalyEventRow(
                    id=str(uuid4()),
                    run_id=run["id"],
                    sample_index=162,
                    severity="critical",
                    state="open",
                    anomaly_score=5.1,
                    detail={},
                ),
            ]
        )

    events = client.get(f"/api/v1/runs/{run['id']}/events")

    assert events.status_code == 200
    assert [(event["sampleIndex"], event["state"]) for event in events.json()] == [
        (162, "open"),
        (51, "resolved"),
    ]


def test_online_restart_clears_only_current_run_products(client: TestClient):
    first = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "online"},
    ).json()
    second = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "online"},
    ).json()
    with client.app.state.database.session() as session:
        session.add_all(
            [
                RunStreamMessageRow(
                    run_id=first["id"],
                    event_type="inference",
                    sample_index=3,
                    payload={"runId": first["id"], "sampleIndex": 3},
                    created_at=datetime.now(UTC).replace(tzinfo=None),
                ),
                RunStreamMessageRow(
                    run_id=second["id"],
                    event_type="inference",
                    sample_index=4,
                    payload={"runId": second["id"], "sampleIndex": 4},
                    created_at=datetime.now(UTC).replace(tzinfo=None),
                ),
            ]
        )

    restarted = client.post(
        f"/api/v1/runs/{first['id']}/control",
        json={"action": "restart"},
    )
    assert restarted.status_code == 200
    assert restarted.json()["state"] == "ready"
    assert restarted.json()["currentSample"] == 0

    with client.app.state.database.session() as session:
        first_messages = session.query(RunStreamMessageRow).filter_by(run_id=first["id"]).all()
        second_messages = session.query(RunStreamMessageRow).filter_by(run_id=second["id"]).all()
    assert [message.event_type for message in first_messages] == ["state"]
    assert len(second_messages) >= 2


def test_terminal_run_rejects_control_until_explicit_restart(client: TestClient):
    run = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "online"},
    ).json()
    with client.app.state.database.session() as session:
        session.get(ReplayRunRow, run["id"]).state = "completed"

    for body in (
        {"action": "play"},
        {"action": "pause"},
        {"action": "seek", "sampleIndex": 3},
    ):
        response = client.post(f"/api/v1/runs/{run['id']}/control", json=body)
        assert response.status_code == 409
        assert response.json()["code"] == "run_terminal"

    restarted = client.post(
        f"/api/v1/runs/{run['id']}/control",
        json={"action": "restart"},
    )
    assert restarted.status_code == 200
    assert restarted.json()["state"] == "ready"


def test_sse_closes_immediately_after_terminal_message(client: TestClient):
    run = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "online"},
    ).json()
    with client.app.state.database.session() as session:
        session.add(
            RunStreamMessageRow(
                run_id=run["id"],
                event_type="completed",
                sample_index=1,
                payload={"runId": run["id"], "currentSample": 1},
                created_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )

    response = client.get(f"/api/v1/runs/{run['id']}/stream")

    assert response.status_code == 200
    assert "event: completed" in response.text
    assert "event: heartbeat" not in response.text


def test_sse_replays_durable_messages_after_database_cursor(client: TestClient):
    run = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "online"},
    ).json()
    with client.app.state.database.session() as session:
        session.add(
            RunStreamMessageRow(
                run_id=run["id"],
                event_type="inference",
                sample_index=8,
                payload={
                    "runId": run["id"],
                    "sampleIndex": 8,
                    "t2": 1.2,
                    "spe": 0.4,
                    "anomalyScore": 0.2,
                    "alarmState": "normal",
                    "modelVersion": run["modelVersion"],
                    "latencyMs": 0.5,
                },
                created_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        session.flush()
        cursor = session.query(RunStreamMessageRow).filter_by(run_id=run["id"]).first().id

    response = client.get(
        f"/api/v1/runs/{run['id']}/stream",
        headers={"Last-Event-ID": str(cursor)},
    )

    assert response.status_code == 200
    assert "event: state" not in response.text
    assert "event: inference" in response.text
    assert f'"runId":"{run["id"]}"' in response.text
    assert '"inference":{"runId"' in response.text


def test_sse_stream_emits_bounded_periodic_heartbeats(client: TestClient):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    response = client.get(f"/api/v1/runs/{run['id']}/stream")

    assert response.status_code == 200
    assert response.headers["connection"] == "keep-alive"
    assert response.text.count("event: heartbeat") == 3
    event_ids = [
        int(line.removeprefix("id: "))
        for line in response.text.splitlines()
        if line.startswith("id: ")
    ]
    assert event_ids == sorted(set(event_ids))


def test_production_sse_defaults_to_long_lived_heartbeat_configuration(tmp_path: Path):
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'production-default.db'}",
        data_dir=tmp_path,
    )

    assert app.state.sse_heartbeat_interval_seconds == 15.0
    assert app.state.sse_heartbeat_count is None


def test_event_detail_decision_and_record_are_auditable(client: TestClient, lead_headers):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    events = client.get(f"/api/v1/runs/{run['id']}/events")
    assert events.status_code == 200
    event = events.json()[0]
    detail = client.get(f"/api/v1/events/{event['id']}")
    assert detail.status_code == 200
    assert len(detail.json()["evidence"]) == 3
    assert detail.json()["recommendation"]["mode"] == "degraded"
    assert detail.json()["recommendation"]["safetyBoundary"] == (
        "Read-only advice. No automatic control write-back."
    )

    decision_request = {
        "decision": "confirm",
        "note": "按证据顺序检查冷却水回路",
    }
    decision = client.post(
        f"/api/v1/events/{event['id']}/decision",
        json=decision_request,
        headers={"Idempotency-Key": "decision-1", "X-Trace-ID": "trace-decision", **lead_headers},
    )
    duplicate = client.post(
        f"/api/v1/events/{event['id']}/decision",
        json=decision_request,
        headers={"Idempotency-Key": "decision-1", **lead_headers},
    )
    assert decision.status_code == 201
    assert duplicate.status_code == 201
    assert duplicate.json() == decision.json()
    assert decision.json()["operatorRole"] == "shift_lead"
    assert "shift-lead" in decision.json()["operatorName"]
    record = client.get(f"/api/v1/records/{decision.json()['id']}")
    assert record.status_code == 200
    assert record.json()["traceId"] == "trace-decision"
    assert record.json()["operatorRole"] == "shift_lead"


def test_rejected_decision_uses_anomaly_event_contract_state(client: TestClient, lead_headers):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    event = client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
    decision = client.post(
        f"/api/v1/events/{event['id']}/decision",
        json={"decision": "reject", "note": "误报"},
        headers=lead_headers,
    )
    assert decision.status_code == 201
    detail = client.get(f"/api/v1/events/{event['id']}")
    assert detail.status_code == 200
    assert detail.json()["state"] == "rejected"


def test_errors_use_shared_problem_shape_and_trace_id(client: TestClient):
    missing = client.get("/api/v1/runs/00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404
    assert set(missing.json()) >= {"code", "message", "traceId"}

    invalid = client.post("/api/v1/runs", json={})
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "validation_error"
    assert invalid.json()["traceId"]


def test_invalid_sse_cursor_is_a_problem_not_a_reset(client: TestClient):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    response = client.get(
        f"/api/v1/runs/{run['id']}/stream",
        headers={"Last-Event-ID": "not-a-number"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_last_event_id"


def test_readiness_does_not_claim_database_available_when_select_fails(tmp_path: Path):
    app = create_app(database_url=f"sqlite:///{tmp_path / 'ready.db'}", data_dir=tmp_path)

    def fail_select_one():
        raise RuntimeError("database unavailable")

    app.state.database.check_ready = fail_select_one
    with TestClient(app) as test_client:
        response = test_client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["code"] == "database_not_ready"


def test_catalog_rejects_invalid_provenance_without_relabeling(tmp_path: Path):
    (tmp_path / "manifest.json").write_text(
        json.dumps(
            {
                "scenarios": [
                    {
                        "id": "not-tep",
                        "name": "Unknown source",
                        "faultId": 1,
                        "sampleCount": 100,
                        "faultOnsetSample": 10,
                        "sourceLabel": "unverified customer data",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    catalog = DataCatalog(tmp_path)
    assert catalog.get("not-tep") is None
    assert catalog.readiness()[0] == "degraded"
    assert catalog.readiness()[1] != "manifest loaded"


def test_catalog_rejects_allowlisted_source_with_mismatched_domain(tmp_path: Path):
    (tmp_path / "manifest.json").write_text(
        json.dumps(
            {
                "scenarios": [
                    {
                        "id": "mislabeled-source",
                        "name": "Mismatched source",
                        "faultId": 0,
                        "sampleCount": 100,
                        "faultOnsetSample": 10,
                        "sourceLabel": "UCI Water Treatment Plant public sensor data",
                        "domain": "continuous_chemical",
                        "modelFamily": "tep-pca-hgb",
                        "sampleIntervalSeconds": 180,
                        "recommendedInferenceMode": "online",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    catalog = DataCatalog(tmp_path)

    assert catalog.get("mislabeled-source") is None
    assert catalog.readiness()[0] == "degraded"


def test_openapi_surface_matches_frozen_contract():
    app = create_app(database_url="sqlite:///:memory:", data_dir=Path("/does/not/exist"))
    actual = app.openapi()
    contract = yaml.safe_load(
        Path(__file__)
        .parents[3]
        .joinpath("packages/contracts/openapi.yaml")
        .read_text(encoding="utf-8")
    )
    for path, methods in contract["paths"].items():
        assert path in actual["paths"]
        for method, operation in methods.items():
            assert actual["paths"][path][method]["operationId"] == operation["operationId"]
            assert set(actual["paths"][path][method]["responses"]) == set(operation["responses"])
    assert "Problem" in actual["components"]["responses"]
    for name in (
        "Health",
        "Scenario",
        "ReplayRun",
        "AnomalyEvent",
        "EventDetail",
        "PredictionEvidence",
        "DecisionRecord",
        "Problem",
    ):
        assert name in actual["components"]["schemas"]
    event_required = set(actual["components"]["schemas"]["EventDetail"].get("required", []))
    assert {
        "detectionSample",
        "diagnosisSample",
        "diagnosisDelaySamples",
        "diagnosisState",
        "diagnosisAnomalyScore",
        "anomalyLatched",
        "initialCandidates",
    } <= event_required
    scenario_required = set(actual["components"]["schemas"]["Scenario"].get("required", []))
    assert {
        "domain",
        "modelFamily",
        "sampleIntervalSeconds",
        "recommendedInferenceMode",
    } <= scenario_required
