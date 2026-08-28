import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from process_copilot_api.db import AIInteractionRow
from process_copilot_api.main import create_app


@pytest.fixture()
def ask_client(tmp_path: Path):
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
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_dir=data_dir,
        sse_heartbeat_interval_seconds=0.001,
        sse_heartbeat_count=1,
    )
    with TestClient(app) as client:
        yield client, app


def operator_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "operator-01", "password": "demo-op-2026"},
    )
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_event_question_requires_login_and_persists_template_answer(ask_client) -> None:
    client, app = ask_client
    run = client.post(
        "/api/v1/runs",
        json={"scenarioId": "tep-fault-05", "inferenceMode": "template"},
    ).json()
    event = client.get(f"/api/v1/runs/{run['id']}/events").json()[0]
    url = f"/api/v1/events/{event['id']}/ask"

    assert client.post(url, json={"question": "原因是什么？"}).status_code == 401
    response = client.post(
        url,
        headers={**operator_headers(client), "X-Trace-ID": "trace-ask"},
        json={"question": "原因是什么？"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "template"
    assert response.json()["traceId"] == "trace-ask"
    assert response.json()["evidenceRefs"]
    with app.state.database.session() as session:
        stored = session.query(AIInteractionRow).one()
        assert stored.question == "原因是什么？"
        assert stored.trace_id == "trace-ask"


def test_event_question_validates_event_and_length(ask_client) -> None:
    client, _app = ask_client
    headers = operator_headers(client)
    missing = client.post(
        "/api/v1/events/00000000-0000-0000-0000-000000000000/ask",
        headers=headers,
        json={"question": "原因是什么？"},
    )
    assert missing.status_code == 404

    too_long = client.post(
        "/api/v1/events/00000000-0000-0000-0000-000000000000/ask",
        headers=headers,
        json={"question": "问" * 501},
    )
    assert too_long.status_code == 422
