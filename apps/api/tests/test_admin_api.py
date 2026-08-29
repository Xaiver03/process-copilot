import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from process_copilot_api.db import (
    AIConfigurationRow,
    ReplayRunRow,
    RunInferenceStateRow,
)
from process_copilot_api.llm import ExplanationResult
from process_copilot_api.main import create_app
from sqlalchemy import text


@pytest.fixture()
def admin_client(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "processed"
    data_dir.mkdir()
    (data_dir / "manifest.json").write_text(
        json.dumps(
            {
                "scenarios": [
                    {
                        "id": "tep-fault-05",
                        "name": "冷却水流量偏移",
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
    monkeypatch.setenv("AI_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("LLM_PROVIDER", "disabled")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_dir=data_dir,
        sse_heartbeat_interval_seconds=0.001,
        sse_heartbeat_count=1,
    )
    with TestClient(app) as client:
        yield client, app


def auth_headers(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def enable_language_model(
    client: TestClient,
    headers: dict[str, str],
    *,
    expected_version: int = 1,
    model: str = "demo-model",
) -> dict[str, object]:
    response = client.put(
        "/api/v1/admin/ai/config",
        headers={**headers, "Idempotency-Key": f"enable-{expected_version}-{model}"},
        json={
            "enabled": True,
            "provider": "openai-compatible",
            "baseUrl": "https://provider.example/v1",
            "model": model,
            "timeoutMs": 8000,
            "maxTokens": 500,
            "temperature": 0.35,
            "promptVersion": "event-copilot-v01",
            "fallbackPolicy": "degraded",
            "apiKey": "provider-secret",
            "expectedVersion": expected_version,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_admin_endpoints_require_admin_role(admin_client) -> None:
    client, _app = admin_client
    operator = auth_headers(client, "operator-01", "demo-op-2026")
    lead = auth_headers(client, "shift-lead", "demo-lead-2026")
    admin = auth_headers(client, "system-admin", "demo-admin-2026")

    assert client.get("/api/v1/admin/overview").status_code == 401
    assert client.get("/api/v1/admin/overview", headers=operator).status_code == 403
    assert client.get("/api/v1/admin/overview", headers=lead).status_code == 403
    overview = client.get("/api/v1/admin/overview", headers=admin)
    assert overview.status_code == 200
    assert "recentLLMCalls" in overview.json()
    assert "recentLlmCalls" not in overview.json()


def test_admin_can_update_encrypted_config_with_optimistic_version(admin_client) -> None:
    client, app = admin_client
    headers = auth_headers(client, "system-admin", "demo-admin-2026")
    initial = client.get("/api/v1/admin/ai/config", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["version"] == 1
    assert initial.json()["apiKeyConfigured"] is False

    updated = client.put(
        "/api/v1/admin/ai/config",
        headers={**headers, "Idempotency-Key": "config-update-1"},
        json={
            "enabled": True,
            "provider": "openai-compatible",
            "baseUrl": "https://provider.example/v1",
            "model": "demo-model",
            "timeoutMs": 8000,
            "maxTokens": 500,
            "temperature": 0.2,
            "promptVersion": "event-copilot-v01",
            "fallbackPolicy": "template",
            "apiKey": "provider-secret",
            "expectedVersion": 1,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == 2
    assert updated.json()["apiKeyConfigured"] is True
    assert "apiKey" not in updated.json()

    with app.state.database.session() as session:
        row = session.get(AIConfigurationRow, "default")
        assert row is not None
        assert row.api_key_ciphertext != "provider-secret"
        assert "provider-secret" not in row.api_key_ciphertext

    stale = client.put(
        "/api/v1/admin/ai/config",
        headers=headers,
        json={"model": "stale-model", "expectedVersion": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "ai_config_version_conflict"

    audit = client.get("/api/v1/admin/audit", headers=headers)
    assert audit.status_code == 200
    assert audit.json()["total"] == 1
    serialized = json.dumps(audit.json(), ensure_ascii=False)
    assert "provider-secret" not in serialized


def test_connection_test_is_audited_and_rate_limited(admin_client) -> None:
    client, _app = admin_client
    headers = auth_headers(client, "system-admin", "demo-admin-2026")

    for _ in range(3):
        response = client.post(
            "/api/v1/admin/ai/test",
            headers=headers,
            json={"question": "连接是否正常？"},
        )
        assert response.status_code == 200
        assert response.json()["mode"] == "degraded"
        assert response.json()["ok"] is False

    limited = client.post(
        "/api/v1/admin/ai/test",
        headers=headers,
        json={"question": "第四次测试"},
    )
    assert limited.status_code == 429

    audit = client.get("/api/v1/admin/audit", headers=headers).json()
    assert audit["total"] == 3


def test_language_model_status_requires_real_probe_for_current_config(admin_client) -> None:
    client, _app = admin_client
    headers = auth_headers(client, "system-admin", "demo-admin-2026")
    updated = enable_language_model(client, headers)

    response = client.get("/api/v1/admin/ai/status", headers=headers)

    assert response.status_code == 200
    language_model = response.json()["languageModel"]
    assert language_model["status"] == "unknown"
    assert language_model["version"] == updated["model"]
    assert language_model["latencyMs"] is None
    assert "尚未完成真实调用验证" in language_model["reason"]


def test_successful_connection_probe_marks_current_config_ready(admin_client, monkeypatch) -> None:
    client, app = admin_client
    headers = auth_headers(client, "system-admin", "demo-admin-2026")
    updated = enable_language_model(client, headers)
    captured_settings = []

    class SuccessfulEnhancer:
        def __init__(self, settings):
            captured_settings.append(settings)

        def enhance(self, event_summary, question, *, trace_id=None):
            return ExplanationResult(
                answer="连接正常。",
                mode="llm_enhanced",
                model="demo-model",
                evidence_refs=["XMEAS(1)"],
                latency_ms=7,
                trace_id=trace_id or "trace-test",
            )

    monkeypatch.setattr("process_copilot_api.main.ExplanationEnhancer", SuccessfulEnhancer)

    tested = client.post(
        "/api/v1/admin/ai/test",
        headers=headers,
        json={"question": "连接是否正常？"},
    )
    status = client.get("/api/v1/admin/ai/status", headers=headers)

    assert tested.status_code == 200
    assert tested.json()["ok"] is True
    assert captured_settings[0].temperature == 0.35
    assert captured_settings[0].fallback_policy == "degraded"
    language_model = status.json()["languageModel"]
    assert language_model == {
        "status": "ready",
        "version": updated["model"],
        "latencyMs": 7.0,
        "reason": None,
    }
    with app.state.database.session() as session:
        probe = (
            session.execute(
                text("SELECT config_version, mode FROM ai_runtime_probes WHERE id = :id"),
                {"id": "language-model"},
            )
            .mappings()
            .one()
        )
        assert probe["config_version"] == updated["version"]
        assert probe["mode"] == "llm_enhanced"


def test_probe_from_previous_config_version_is_not_reused(admin_client, monkeypatch) -> None:
    client, _app = admin_client
    headers = auth_headers(client, "system-admin", "demo-admin-2026")
    enabled = enable_language_model(client, headers)

    class SuccessfulEnhancer:
        def __init__(self, settings):
            self.settings = settings

        def enhance(self, event_summary, question, *, trace_id=None):
            return ExplanationResult(
                answer="连接正常。",
                mode="llm_enhanced",
                model=self.settings.model,
                evidence_refs=["XMEAS(1)"],
                latency_ms=5,
                trace_id=trace_id or "trace-test",
            )

    monkeypatch.setattr("process_copilot_api.main.ExplanationEnhancer", SuccessfulEnhancer)
    assert client.post("/api/v1/admin/ai/test", headers=headers).json()["ok"] is True

    changed = client.put(
        "/api/v1/admin/ai/config",
        headers=headers,
        json={"model": "next-model", "expectedVersion": enabled["version"]},
    )
    assert changed.status_code == 200
    status = client.get("/api/v1/admin/ai/status", headers=headers).json()["languageModel"]

    assert status["status"] == "unknown"
    assert status["version"] == "next-model"
    assert "尚未完成真实调用验证" in status["reason"]


def test_admin_status_never_exposes_raw_worker_failure(admin_client) -> None:
    client, app = admin_client
    headers = auth_headers(client, "system-admin", "demo-admin-2026")
    with app.state.database.session() as session:
        session.add(
            ReplayRunRow(
                id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                scenario_id="tep-fault-05",
                state="playing",
                speed=20,
                current_sample=1,
                created_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        session.add(
            RunInferenceStateRow(
                run_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                mode="online",
                model_version="model-v1",
                worker_id="worker-secret",
                heartbeat_at=datetime.now(UTC).replace(tzinfo=None),
                failure_reason="/private/server/path leaked provider-secret",
            )
        )

    overview = client.get("/api/v1/admin/overview", headers=headers)

    assert overview.status_code == 200
    serialized = json.dumps(overview.json(), ensure_ascii=False)
    assert "/private/server/path" not in serialized
    assert "provider-secret" not in serialized


def test_production_admin_ai_mutations_are_read_only_by_default(admin_client, monkeypatch) -> None:
    client, _app = admin_client
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("OPERATOR_TOKEN_SECRET", "test-production-token-secret-000001")
    monkeypatch.delenv("ADMIN_AI_CONFIG_WRITE_ENABLED", raising=False)
    headers = auth_headers(client, "system-admin", "demo-admin-2026")

    update = client.put(
        "/api/v1/admin/ai/config",
        headers=headers,
        json={"model": "must-not-change", "expectedVersion": 1},
    )
    connection_test = client.post(
        "/api/v1/admin/ai/test",
        headers=headers,
        json={"question": "不得发出服务端请求"},
    )

    assert update.status_code == 403
    assert update.json()["code"] == "admin_ai_read_only"
    assert connection_test.status_code == 403
    assert connection_test.json()["code"] == "admin_ai_read_only"
