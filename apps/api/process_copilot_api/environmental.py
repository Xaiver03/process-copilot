"""Loader for the illustrative Xifeng park environmental scenarios.

Kept deliberately separate from ``catalog.DataCatalog``: the Tennessee
Eastman Process catalog enforces a strict provenance guard tied to one real
public dataset. The scenarios loaded here are synthetic and honestly labeled
as such (see ``services/ml/process_copilot_ml/environmental_scenarios.py``);
mixing the two loaders would blur that distinction.
"""

from __future__ import annotations

import json
from pathlib import Path

from .schemas import (
    EnvironmentalEarlyWarning,
    EnvironmentalScenario,
    EnvironmentalScenarioDetail,
    EnvironmentalTelemetrySeries,
)


class EnvironmentalCatalog:
    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir) / "environmental"
        self._details: dict[str, EnvironmentalScenarioDetail] = self._load()

    @property
    def scenarios(self) -> list[EnvironmentalScenario]:
        return [detail.scenario for detail in self._details.values()]

    def detail(self, scenario_id: str) -> EnvironmentalScenarioDetail | None:
        return self._details.get(scenario_id)

    def _load(self) -> dict[str, EnvironmentalScenarioDetail]:
        results: dict[str, EnvironmentalScenarioDetail] = {}
        if not self.data_dir.exists():
            return results
        for scenario_dir in sorted(self.data_dir.iterdir()):
            if not scenario_dir.is_dir():
                continue
            try:
                detail = self._read_scenario(scenario_dir)
            except (OSError, ValueError, KeyError, TypeError):
                continue
            if detail is not None:
                results[detail.scenario.id] = detail
        return results

    def _read_scenario(self, scenario_dir: Path) -> EnvironmentalScenarioDetail | None:
        scenario_path = scenario_dir / "environmental_scenario.json"
        telemetry_path = scenario_dir / "telemetry.json"
        warning_path = scenario_dir / "early_warning.json"
        if not (scenario_path.is_file() and telemetry_path.is_file() and warning_path.is_file()):
            return None
        scenario = EnvironmentalScenario.model_validate(
            json.loads(scenario_path.read_text(encoding="utf-8"))
        )
        telemetry_payload = json.loads(telemetry_path.read_text(encoding="utf-8"))
        series = [
            EnvironmentalTelemetrySeries(variable_id=key, values=values)
            for key, values in telemetry_payload["series"].items()
        ]
        early_warning = EnvironmentalEarlyWarning.model_validate(
            json.loads(warning_path.read_text(encoding="utf-8"))
        )
        return EnvironmentalScenarioDetail(
            scenario=scenario,
            day_index=telemetry_payload["dayIndex"],
            series=series,
            early_warning=early_warning,
        )
