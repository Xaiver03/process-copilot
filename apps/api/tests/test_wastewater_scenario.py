import json
from pathlib import Path

from fastapi.testclient import TestClient

from process_copilot_api.main import create_app


REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data" / "processed"


def test_default_wastewater_scenario_is_first_and_template_event_has_prediction(tmp_path: Path):
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_dir=DATA_DIR,
    )

    with TestClient(app) as client:
        scenarios_response = client.get("/api/v1/scenarios")
        assert scenarios_response.status_code == 200
        scenarios = scenarios_response.json()
        assert scenarios[0]["id"] == "uci-wtp-effluent-cod-risk"
        assert scenarios[0]["domain"] == "wastewater"
        assert scenarios[0]["modelFamily"] == "uci-wtp-rf-softsensor"
        assert scenarios[0]["sampleCount"] == 101
        assert scenarios[0]["sourceLabel"] == "UCI Water Treatment Plant public sensor data"
        assert [scenario["id"] for scenario in scenarios[1:]] == [
            "tep-f01-feed-ratio-step",
            "tep-f06-a-feed-loss",
            "tep-f13-kinetics-drift",
        ]

        run_response = client.post(
            "/api/v1/runs",
            json={"scenarioId": "uci-wtp-effluent-cod-risk", "inferenceMode": "template"},
        )
        assert run_response.status_code == 201
        run = run_response.json()
        assert run["modelVersion"] == "uci-wtp-rf-softsensor-5e5ff4f8"

        events_response = client.get(f"/api/v1/runs/{run['id']}/events")
        assert events_response.status_code == 200
        events = events_response.json()
        assert len(events) == 1

        detail_response = client.get(f"/api/v1/events/{events[0]['id']}")
        assert detail_response.status_code == 200
        detail = detail_response.json()

    assert detail["sampleIndex"] == 42
    assert detail["prediction"] == {
        "targetId": "DQO-S",
        "targetName": "出水化学需氧量",
        "unit": "mg/L",
        "horizonSamples": 1,
        "horizonLabel": "下一条公开记录（演示下一化验周期）",
        "predictedValue": 117.45,
        "observedValue": None,
        "historicalHighBoundary": 147.0,
        "uncertaintyMae": 33.93930693069307,
        "lowerBound": 40.13,
        "upperBound": 157.49,
        "riskLevel": "elevated",
        "boundaryBasis": "训练段 DQO-S P95，不是法律排放限值。",
    }
    assert detail["modelVersion"] == "uci-wtp-rf-softsensor-5e5ff4f8"
    assert detail["dataSourceDisclosure"] == (
        "Public UCI wastewater sensor data, not real Guizhou plant data."
    )
    assert [item["variableId"] for item in detail["evidence"]] == ["PH-P", "PH-E", "Q-E"]
    assert all("不代表已证实因果" in item["summary"] for item in detail["evidence"])
    assert [item["probability"] for item in detail["candidates"]] == [0.407, 0.407, 0.186]
    assert "不确定区间上界" in detail["recommendation"]["risk"]
