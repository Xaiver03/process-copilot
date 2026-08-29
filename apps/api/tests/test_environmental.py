import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from process_copilot_api.catalog import DataCatalog
from process_copilot_api.main import create_app
from process_copilot_ml.environmental_scenarios import build_environmental_scenarios


@pytest.fixture()
def client_without_environmental_data(tmp_path: Path):
    data_dir = tmp_path / "processed"
    data_dir.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_dir=data_dir,
        sse_heartbeat_interval_seconds=0.001,
        sse_heartbeat_count=3,
    )
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def client(tmp_path: Path):
    data_dir = tmp_path / "processed"
    data_dir.mkdir()
    build_environmental_scenarios(data_dir / "environmental", seed=42)
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_dir=data_dir,
        sse_heartbeat_interval_seconds=0.001,
        sse_heartbeat_count=3,
    )
    with TestClient(app) as test_client:
        yield test_client


def test_empty_environmental_catalog_returns_empty_list(
    client_without_environmental_data: TestClient,
):
    response = client_without_environmental_data.get("/api/v1/environmental-scenarios")
    assert response.status_code == 200
    assert response.json() == []


def test_list_environmental_scenarios(client: TestClient):
    response = client.get("/api/v1/environmental-scenarios")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    scenario = payload[0]
    assert scenario["id"] == "xifeng-jiaoyishan-leachate"
    assert "not real sensor data" in scenario["sourceLabel"]
    assert scenario["regulatoryLimitValue"] == 0.3
    assert len(scenario["citations"]) >= 1


def test_get_environmental_scenario_detail_has_early_warning_lead_time(client: TestClient):
    response = client.get("/api/v1/environmental-scenarios/xifeng-jiaoyishan-leachate")
    assert response.status_code == 200
    payload = response.json()
    assert payload["scenario"]["id"] == "xifeng-jiaoyishan-leachate"
    assert len(payload["dayIndex"]) == 180
    series_ids = {series["variableId"] for series in payload["series"]}
    assert "total_phosphorus_mg_l" in series_ids
    assert "membrane_anomaly_score" in series_ids
    warning = payload["earlyWarning"]
    assert warning["triggered"] is True
    assert warning["leadTimeDays"] > 0
    assert warning["warningDay"] < warning["breachDay"]


def test_get_environmental_scenario_detail_missing_returns_problem(client: TestClient):
    response = client.get("/api/v1/environmental-scenarios/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "environmental_scenario_not_found"


def test_environmental_directory_does_not_pollute_tep_data_catalog(tmp_path: Path):
    data_dir = tmp_path / "processed"
    data_dir.mkdir()
    (data_dir / "manifest.json").write_text(
        json.dumps(
            {
                "scenarios": [
                    {
                        "id": "tep-fault-05",
                        "name": "x",
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
    build_environmental_scenarios(data_dir / "environmental", seed=42)

    catalog = DataCatalog(data_dir)
    assert catalog.source == "manifest"
    assert catalog.readiness() == ("ok", "manifest loaded")
    assert [scenario.id for scenario in catalog.scenarios] == ["tep-fault-05"]


def test_environmental_scenarios_never_reuse_tep_source_label(client: TestClient):
    scenarios_response = client.get("/api/v1/environmental-scenarios")
    tep_response = client.get("/api/v1/scenarios")
    environmental_labels = {item["sourceLabel"] for item in scenarios_response.json()}
    tep_labels = {item["sourceLabel"] for item in tep_response.json()}
    assert environmental_labels.isdisjoint(tep_labels)
