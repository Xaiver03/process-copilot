import pytest
from process_copilot_api.capacity_planner import simulate_capacity_plan
from process_copilot_api.schemas import CapacityLineRequest, CapacityPlanRequest


def _request(**overrides) -> CapacityPlanRequest:
    payload = {
        "gypsum_cap_tpd": 1000.0,
        "gypsum_ratio_low": 4.0,
        "gypsum_ratio_high": 5.0,
        "lines": [
            CapacityLineRequest(id="fertilizer", name="磷肥支路", requested_p2o5_tpd=100.0, priority=1),
            CapacityLineRequest(id="purified-acid", name="净化磷酸支路", requested_p2o5_tpd=80.0, priority=2),
        ],
    }
    payload.update(overrides)
    return CapacityPlanRequest.model_validate(payload)


def test_within_cap_request_has_single_option():
    response = simulate_capacity_plan(_request(gypsum_cap_tpd=2000.0))
    assert response.request_within_cap is True
    assert len(response.options) == 1
    assert response.options[0].within_cap is True
    assert response.total_requested_p2o5_tpd == pytest.approx(180.0)
    assert response.requested_gypsum_output_low_tpd == pytest.approx(720.0)
    assert response.requested_gypsum_output_high_tpd == pytest.approx(900.0)


def test_over_cap_request_produces_three_mitigation_options():
    response = simulate_capacity_plan(_request(gypsum_cap_tpd=500.0))
    assert response.request_within_cap is False
    strategies = [option.strategy for option in response.options]
    assert strategies == ["proportional", "proportional", "priority_first", "equal_share"]
    for option in response.options[1:]:
        assert option.within_cap is True
        assert option.gypsum_output_high_tpd <= 500.0 + 1e-6


def test_priority_first_fully_serves_highest_priority_line_first():
    response = simulate_capacity_plan(_request(gypsum_cap_tpd=450.0))
    priority_option = next(o for o in response.options if o.strategy == "priority_first")
    by_id = {line.id: line for line in priority_option.lines}
    # purified-acid has priority=2 (higher), fertilizer has priority=1.
    assert by_id["purified-acid"].load_pct_of_request == pytest.approx(100.0)
    assert by_id["fertilizer"].load_pct_of_request < 100.0


def test_equal_share_splits_conservative_budget_evenly_by_line_count():
    response = simulate_capacity_plan(_request(gypsum_cap_tpd=450.0))
    equal_option = next(o for o in response.options if o.strategy == "equal_share")
    conservative_budget = 450.0 / 5.0
    expected_each = conservative_budget / 2
    for line in equal_option.lines:
        assert line.allocated_p2o5_tpd == pytest.approx(expected_each)


def test_gypsum_ratio_inputs_are_order_independent():
    swapped = simulate_capacity_plan(_request(gypsum_ratio_low=5.0, gypsum_ratio_high=4.0, gypsum_cap_tpd=500.0))
    ordered = simulate_capacity_plan(_request(gypsum_ratio_low=4.0, gypsum_ratio_high=5.0, gypsum_cap_tpd=500.0))
    assert swapped.requested_gypsum_output_low_tpd == ordered.requested_gypsum_output_low_tpd
    assert swapped.requested_gypsum_output_high_tpd == ordered.requested_gypsum_output_high_tpd


def test_disclosure_is_always_present():
    response = simulate_capacity_plan(_request())
    assert "not verified Xifeng park production data" in response.disclosure
