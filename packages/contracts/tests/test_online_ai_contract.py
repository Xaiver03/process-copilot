"""Contract-level checks for online inference and operator collaboration APIs."""

import json
from pathlib import Path

import pytest
import yaml

CONTRACT_DIR = Path(__file__).parents[1]


@pytest.fixture(scope="module")
def openapi() -> dict:
    return yaml.safe_load((CONTRACT_DIR / "openapi.yaml").read_text())


@pytest.fixture(scope="module")
def domain() -> dict:
    return json.loads((CONTRACT_DIR / "schemas" / "domain.schema.json").read_text())


def schema(openapi: dict, name: str) -> dict:
    return openapi["components"]["schemas"][name]


def test_online_inference_operations_are_published(openapi: dict) -> None:
    paths = openapi["paths"]
    assert paths["/api/v1/events/{eventId}/ask"]["post"]["operationId"] == "askEvent"
    assert paths["/api/v1/runs/{runId}/stream"]["get"]["x-sse-message-schema"] == (
        "#/components/schemas/SSEMessage"
    )
    assert paths["/api/v1/admin/overview"]["get"]["operationId"] == "getAdminOverview"
    assert paths["/api/v1/admin/ai/status"]["get"]["operationId"] == "getAIStatus"
    assert paths["/api/v1/admin/ai/config"]["get"]["operationId"] == "getAIConfig"
    assert paths["/api/v1/admin/ai/config"]["put"]["operationId"] == "updateAIConfig"
    assert paths["/api/v1/admin/ai/test"]["post"]["operationId"] == "testAIConnection"
    assert paths["/api/v1/admin/ai/interactions"]["get"]["operationId"] == "listAIInteractions"
    assert paths["/api/v1/admin/audit"]["get"]["operationId"] == "listAdminAudit"


def test_replay_run_freezes_inference_mode(openapi: dict, domain: dict) -> None:
    replay = schema(openapi, "ReplayRun")
    assert {
        "id",
        "scenarioId",
        "state",
        "speed",
        "currentSample",
        "createdAt",
        "inferenceMode",
        "modelVersion",
    } <= set(replay["required"])
    assert replay["properties"]["inferenceMode"]["enum"] == ["online", "template"]
    create = schema(openapi, "CreateRunRequest")
    assert create["properties"]["inferenceMode"]["enum"] == ["online", "template"]
    assert domain["$defs"]["ReplayRun"]["properties"]["inferenceMode"]["enum"] == [
        "online",
        "template",
    ]


def test_inference_and_sse_schemas_have_stable_discriminators(openapi: dict, domain: dict) -> None:
    inference_required = {
        "runId",
        "sampleIndex",
        "t2",
        "spe",
        "anomalyScore",
        "alarmState",
        "modelVersion",
        "latencyMs",
    }
    assert inference_required <= set(schema(openapi, "InferenceSnapshot")["required"])
    assert inference_required <= set(domain["$defs"]["InferenceSnapshot"]["required"])

    event_types = [
        "state",
        "inference",
        "anomaly_opened",
        "diagnosis_updated",
        "completed",
        "failed",
        "heartbeat",
    ]
    assert schema(openapi, "SSEMessage")["properties"]["type"]["enum"] == event_types
    assert domain["$defs"]["SSEMessage"]["properties"]["type"]["enum"] == event_types


def test_ai_answer_is_explicitly_degradable(openapi: dict, domain: dict) -> None:
    required = {"answer", "mode", "model", "evidenceRefs", "latencyMs", "traceId"}
    assert required <= set(schema(openapi, "AIAnswer")["required"])
    assert schema(openapi, "AIAnswer")["properties"]["mode"]["enum"] == [
        "llm_enhanced",
        "template",
        "degraded",
    ]
    assert required <= set(domain["$defs"]["AIAnswer"]["required"])

    ask = schema(openapi, "AskEventRequest")
    assert ask["properties"]["question"] == {"type": "string", "minLength": 1, "maxLength": 500}
    assert domain["$defs"]["AskEventRequest"]["properties"]["question"]["maxLength"] == 500


def test_ai_status_and_admin_contract_never_return_api_key(openapi: dict, domain: dict) -> None:
    status_required = {
        "inferenceMode",
        "worker",
        "industrialModel",
        "languageModel",
        "dataBuildHash",
    }
    assert status_required <= set(schema(openapi, "AIStatus")["required"])
    assert status_required <= set(domain["$defs"]["AIStatus"]["required"])

    config = schema(openapi, "AIConfig")
    assert "apiKey" not in config["properties"]
    assert "apiKeyConfigured" in config["required"]
    assert "version" in config["required"]
    update = schema(openapi, "UpdateAIConfigRequest")
    assert "apiKey" in update["properties"]
    assert "apiKeyConfigured" not in update["properties"]
    assert "expectedVersion" in update["properties"]
    assert "apiKey" not in domain["$defs"]["AIConfig"]["properties"]


def test_admin_responses_are_paginated_and_auditable(openapi: dict, domain: dict) -> None:
    for name in ("AIInteractionPage", "AdminAuditPage"):
        assert {"items", "total"} <= set(schema(openapi, name)["required"])
        assert {"items", "total"} <= set(domain["$defs"][name]["required"])
    audit = schema(openapi, "AdminAuditEntry")
    assert "apiKey" not in audit["properties"]["changeSummary"].get("properties", {})
    assert audit["properties"]["changeSummary"].get("additionalProperties") is False
    for path in ("/api/v1/admin/ai/interactions", "/api/v1/admin/audit"):
        operation = openapi["paths"][path]["get"]
        references = {parameter["$ref"] for parameter in operation["parameters"]}
        assert {
            "#/components/parameters/Limit",
            "#/components/parameters/Offset",
        } <= references


def test_auth_contract_includes_admin_without_registration(openapi: dict) -> None:
    expected_roles = ["operator", "shift_lead", "admin"]
    assert schema(openapi, "LoginResponse")["properties"]["role"]["enum"] == expected_roles
    assert schema(openapi, "OperatorInfo")["properties"]["role"]["enum"] == expected_roles
    assert "/api/v1/auth/register" not in openapi["paths"]


def test_control_proposals_are_shadow_only_and_never_sent(
    openapi: dict, domain: dict
) -> None:
    path = openapi["paths"]["/api/v1/events/{eventId}/control-proposals"]
    assert path["post"]["operationId"] == "createControlProposal"
    assert path["get"]["operationId"] == "listControlProposals"

    proposal = schema(openapi, "ControlProposal")
    required = {
        "id",
        "eventId",
        "actionDraft",
        "executionMode",
        "state",
        "checks",
        "requestedBy",
        "sent",
        "traceId",
        "createdAt",
    }
    assert required <= set(proposal["required"])
    assert proposal["properties"]["executionMode"]["enum"] == ["shadow"]
    assert proposal["properties"]["state"]["enum"] == ["blocked_demo_boundary"]
    assert proposal["properties"]["sent"]["enum"] == [False]
    assert required <= set(domain["$defs"]["ControlProposal"]["required"])
    assert domain["$defs"]["ControlProposal"]["properties"]["sent"]["enum"] == [
        False
    ]
