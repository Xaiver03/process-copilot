import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from process_copilot_api.catalog import DataCatalog
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
    )
    with TestClient(app) as test_client:
        yield test_client


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


def test_idempotency_rejects_same_key_with_different_request(client: TestClient):
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
        json={"decision": "confirm", "operatorName": "工程师", "note": "确认"},
        headers={"Idempotency-Key": "conflict-decision"},
    )
    decision_conflict = client.post(
        f"/api/v1/events/{event_id}/decision",
        json={"decision": "reject", "operatorName": "工程师", "note": "误报"},
        headers={"Idempotency-Key": "conflict-decision"},
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


def test_concurrent_control_and_decision_idempotency_are_replayed(client: TestClient):
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
                json={"decision": "confirm", "operatorName": "工程师", "note": "确认"},
                headers={"Idempotency-Key": "concurrent-decision"},
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
        headers={"Last-Event-ID": "2"},
    )
    assert resumed.status_code == 200
    assert "event: state" not in resumed.text
    assert "event: anomaly" in resumed.text


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


def test_event_detail_decision_and_record_are_auditable(client: TestClient):
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
        "operatorName": "值班工程师",
        "note": "按证据顺序检查冷却水回路",
    }
    decision = client.post(
        f"/api/v1/events/{event['id']}/decision",
        json=decision_request,
        headers={"Idempotency-Key": "decision-1", "X-Trace-ID": "trace-decision"},
    )
    duplicate = client.post(
        f"/api/v1/events/{event['id']}/decision",
        json=decision_request,
        headers={"Idempotency-Key": "decision-1"},
    )
    assert decision.status_code == 201
    assert duplicate.status_code == 201
    assert duplicate.json() == decision.json()
    record = client.get(f"/api/v1/records/{decision.json()['id']}")
    assert record.status_code == 200
    assert record.json()["traceId"] == "trace-decision"


def test_rejected_decision_uses_anomaly_event_contract_state(client: TestClient):
    run = client.post("/api/v1/runs", json={"scenarioId": "tep-fault-05"}).json()
    event = client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
    decision = client.post(
        f"/api/v1/events/{event['id']}/decision",
        json={"decision": "reject", "operatorName": "工程师", "note": "误报"},
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
