"""Contract checks for the Xifeng park alignment additions.

Covers the two capabilities added on top of the report
《贵阳息烽磷煤化工园区工艺体系分析及AI赋能应用思路》: the illustrative
交椅山渣库 environmental scenario (report §4.4-5) and the "以渣定产"
capacity-plan simulator (report §3.2 漏洞三 / §4.4-6).
"""

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


def test_environmental_scenario_operations_are_published(openapi: dict) -> None:
    paths = openapi["paths"]
    assert paths["/api/v1/environmental-scenarios"]["get"]["operationId"] == (
        "listEnvironmentalScenarios"
    )
    assert paths["/api/v1/environmental-scenarios/{scenarioId}"]["get"]["operationId"] == (
        "getEnvironmentalScenario"
    )
    assert paths["/api/v1/capacity-plan/simulate"]["post"]["operationId"] == (
        "simulateCapacityPlan"
    )


def test_environmental_scenario_never_reuses_the_tep_source_label_constant(
    openapi: dict, domain: dict
) -> None:
    tep_source = schema(openapi, "Scenario")["properties"]["sourceLabel"]
    assert tep_source == {"const": "Tennessee Eastman Process public simulation"}

    environmental_source = schema(openapi, "EnvironmentalScenario")["properties"]["sourceLabel"]
    assert environmental_source == {"type": "string"}
    assert "const" not in environmental_source

    domain_environmental_source = domain["$defs"]["EnvironmentalScenario"]["properties"][
        "sourceLabel"
    ]
    assert domain_environmental_source == {"type": "string"}


def test_environmental_scenario_detail_carries_early_warning_lead_time_fields(
    openapi: dict, domain: dict
) -> None:
    required = {"triggered", "breachVariableId", "summary"}
    assert required <= set(schema(openapi, "EnvironmentalEarlyWarning")["required"])
    assert required <= set(domain["$defs"]["EnvironmentalEarlyWarning"]["required"])
    detail = schema(openapi, "EnvironmentalScenarioDetail")
    assert {"scenario", "dayIndex", "series", "earlyWarning"} <= set(detail["required"])


def test_capacity_plan_request_bounds_number_of_lines(openapi: dict, domain: dict) -> None:
    request = schema(openapi, "CapacityPlanRequest")
    assert request["properties"]["lines"]["minItems"] == 1
    assert request["properties"]["lines"]["maxItems"] == 8
    domain_request = domain["$defs"]["CapacityPlanRequest"]
    assert domain_request["properties"]["lines"]["minItems"] == 1
    assert domain_request["properties"]["lines"]["maxItems"] == 8


def test_capacity_plan_option_strategies_are_stable(openapi: dict, domain: dict) -> None:
    strategies = ["proportional", "priority_first", "equal_share"]
    assert schema(openapi, "CapacityPlanOption")["properties"]["strategy"]["enum"] == strategies
    assert domain["$defs"]["CapacityPlanOption"]["properties"]["strategy"]["enum"] == strategies


def test_problem_schema_declares_every_required_property(openapi: dict) -> None:
    """Regression: traceId was listed in `required` but never declared under
    `properties`, so openapi-typescript silently dropped it from the generated
    TypeScript type (discovered while regenerating api-schema.ts for the
    Xifeng park additions)."""
    problem = schema(openapi, "Problem")
    assert set(problem["required"]) <= set(problem["properties"])


def test_capacity_plan_response_always_discloses_illustrative_nature(
    openapi: dict, domain: dict
) -> None:
    response = schema(openapi, "CapacityPlanResponse")
    assert "disclosure" in response["required"]
    assert response["properties"]["disclosure"] == {"type": "string"}
    assert "disclosure" in domain["$defs"]["CapacityPlanResponse"]["required"]
