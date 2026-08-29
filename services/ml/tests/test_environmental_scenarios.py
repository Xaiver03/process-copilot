import json
from pathlib import Path

from process_copilot_ml.environmental_scenarios import (
    SOURCE_LABEL,
    TOTAL_PHOSPHORUS_LIMIT_MG_L,
    build_environmental_scenarios,
    detect_early_warning,
    generate_series,
)


def test_generate_series_is_deterministic_for_a_fixed_seed():
    first = generate_series(seed=7)
    second = generate_series(seed=7)
    for key in first:
        assert first[key].tolist() == second[key].tolist()


def test_generate_series_differs_across_seeds():
    first = generate_series(seed=1)
    second = generate_series(seed=2)
    assert first["total_phosphorus_mg_l"].tolist() != second["total_phosphorus_mg_l"].tolist()


def test_detect_early_warning_finds_lead_time_before_regulatory_breach():
    series = generate_series(seed=42)
    warning = detect_early_warning(series)
    assert warning["triggered"] is True
    assert warning["breachDay"] is not None
    assert warning["warningDay"] is not None
    assert warning["warningDay"] < warning["breachDay"]
    assert warning["leadTimeDays"] == warning["breachDay"] - warning["warningDay"]
    breach_day = warning["breachDay"]
    assert series["total_phosphorus_mg_l"][breach_day] > TOTAL_PHOSPHORUS_LIMIT_MG_L


def test_build_jiaoyishan_leachate_scenario_writes_expected_files(tmp_path: Path):
    artifacts = build_environmental_scenarios(tmp_path, seed=42)
    assert len(artifacts) == 1
    paths = artifacts[0]
    for key in ("scenario", "telemetry", "early_warning"):
        assert paths[key].is_file()

    scenario = json.loads(paths["scenario"].read_text(encoding="utf-8"))
    assert scenario["id"] == "xifeng-jiaoyishan-leachate"
    assert scenario["sourceLabel"] == SOURCE_LABEL
    assert "not real sensor data" in scenario["sourceLabel"]
    assert len(scenario["variables"]) == 6
    assert len(scenario["citations"]) >= 1

    telemetry = json.loads(paths["telemetry"].read_text(encoding="utf-8"))
    assert len(telemetry["dayIndex"]) == 180
    for values in telemetry["series"].values():
        assert len(values) == 180

    warning = json.loads(paths["early_warning"].read_text(encoding="utf-8"))
    assert warning["triggered"] is True
    assert warning["leadTimeDays"] > 0


def test_build_is_deterministic_for_a_fixed_seed(tmp_path: Path):
    first_dir = tmp_path / "first"
    second_dir = tmp_path / "second"
    build_environmental_scenarios(first_dir, seed=42)
    build_environmental_scenarios(second_dir, seed=42)
    first_telemetry = (first_dir / "xifeng-jiaoyishan-leachate" / "telemetry.json").read_text(
        encoding="utf-8"
    )
    second_telemetry = (second_dir / "xifeng-jiaoyishan-leachate" / "telemetry.json").read_text(
        encoding="utf-8"
    )
    assert first_telemetry == second_telemetry
