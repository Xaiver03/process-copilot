from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .schemas import Scenario

TEP_SOURCE_LABEL = "Tennessee Eastman Process public simulation"
WASTEWATER_SOURCE_LABEL = "UCI Water Treatment Plant public sensor data"
SOURCE_DEFAULTS: dict[str, dict[str, Any]] = {
    TEP_SOURCE_LABEL: {
        "domain": "continuous_chemical",
        "model_family": "tep-pca-hgb",
        "sample_interval_seconds": 180,
        "recommended_inference_mode": "online",
    },
    WASTEWATER_SOURCE_LABEL: {
        "domain": "wastewater",
        "model_family": "uci-wtp-pca-softsensor",
        "sample_interval_seconds": 86400,
        "recommended_inference_mode": "template",
    },
}


class DataCatalog:
    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self._event_templates: dict[str, dict[str, Any]] = {}
        self._provenance_invalid = False
        self._scenarios, self.source = self._load()

    @property
    def scenarios(self) -> list[Scenario]:
        return list(self._scenarios)

    def get(self, scenario_id: str) -> Scenario | None:
        return next((scenario for scenario in self._scenarios if scenario.id == scenario_id), None)

    def event_template(self, scenario_id: str) -> dict[str, Any] | None:
        template = self._event_templates.get(scenario_id)
        if template is None:
            return None
        aliases = {
            "detection_sample": "detectionSample",
            "diagnosis_sample": "diagnosisSample",
            "diagnosis_delay_samples": "diagnosisDelaySamples",
            "diagnosis_state": "diagnosisState",
            "diagnosis_anomaly_score": "diagnosisAnomalyScore",
            "anomaly_latched": "anomalyLatched",
            "initial_candidates": "initialCandidates",
        }
        normalized = dict(template)
        for source, target in aliases.items():
            if source in normalized and target not in normalized:
                normalized[target] = normalized[source]
        return normalized

    def readiness(self) -> tuple[str, str]:
        if self.source == "manifest":
            return "ok", "manifest loaded"
        if self.source == "fallback":
            return "degraded", "manifest unavailable; built-in demo fallback"
        if self.source in {"invalid", "manifest_degraded"}:
            return "degraded", "manifest contains invalid provenance; built-in demo fallback"
        return "degraded", "manifest invalid; built-in demo fallback"

    def _load(self) -> tuple[list[Scenario], str]:
        loaded: list[Scenario] = []
        seen_ids: set[str] = set()
        for candidate in self._manifest_candidates():
            try:
                payload = self._read(candidate)
                scenarios = self._scenarios_from(payload)
                for scenario in scenarios:
                    if scenario.id in seen_ids:
                        continue
                    seen_ids.add(scenario.id)
                    loaded.append(scenario)
                    event_path = candidate.parent / "event-template.json"
                    if event_path.is_file():
                        try:
                            self._event_templates[scenario.id] = json.loads(
                                event_path.read_text(encoding="utf-8")
                            )
                        except (OSError, ValueError):
                            pass
            except (OSError, ValueError, TypeError):
                continue
        if loaded:
            return loaded, "manifest_degraded" if self._provenance_invalid else "manifest"
        if self._provenance_invalid:
            return [
                Scenario(
                    id="tep-fault-01",
                    name="TEP 公开故障演示",
                    description="内置开发回退场景（manifest provenance 无效）",
                    fault_id=1,
                    sample_count=500,
                    fault_onset_sample=120,
                    source_label=TEP_SOURCE_LABEL,
                    **SOURCE_DEFAULTS[TEP_SOURCE_LABEL],
                )
            ], "invalid"
        return [
            Scenario(
                id="tep-fault-01",
                name="TEP 公开故障演示",
                description="内置开发回退场景",
                fault_id=1,
                sample_count=500,
                fault_onset_sample=120,
                source_label=TEP_SOURCE_LABEL,
                **SOURCE_DEFAULTS[TEP_SOURCE_LABEL],
            )
        ], "fallback"

    def _manifest_candidates(self) -> list[Path]:
        if not self.data_dir.exists():
            return []
        preferred = [
            self.data_dir / name for name in ("manifest.json", "manifest.yaml", "manifest.yml")
        ]
        discovered = sorted(
            path
            for path in self.data_dir.rglob("*")
            if path.is_file()
            and (
                path.name.endswith(".manifest.json")
                or path.name in {"scenarios.json", "scenario.json"}
            )
        )
        return preferred + [path for path in discovered if path not in preferred]

    def _read(self, path: Path) -> Any:
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".json":
            return json.loads(text)
        import yaml

        return yaml.safe_load(text)

    def _scenarios_from(self, payload: Any) -> list[Scenario]:
        if isinstance(payload, list):
            raw_scenarios = payload
        elif isinstance(payload, dict):
            if {"id", "sampleCount", "faultId"}.issubset(payload):
                raw_scenarios = [payload]
            else:
                raw_scenarios = payload.get("scenarios") or payload.get("items") or []
        else:
            raw_scenarios = []
        result: list[Scenario] = []
        for raw in raw_scenarios:
            if not isinstance(raw, dict):
                continue
            normalized = {
                "id": raw.get("id"),
                "name": raw.get("name") or raw.get("label") or raw.get("id"),
                "description": raw.get("description"),
                "fault_id": raw.get("faultId", raw.get("fault_id", 0)),
                "sample_count": raw.get("sampleCount", raw.get("sample_count")),
                "fault_onset_sample": raw.get("faultOnsetSample", raw.get("fault_onset_sample", 0)),
                "source_label": raw.get("sourceLabel", raw.get("source_label")),
                "domain": raw.get("domain"),
                "model_family": raw.get("modelFamily", raw.get("model_family")),
                "sample_interval_seconds": raw.get(
                    "sampleIntervalSeconds", raw.get("sample_interval_seconds")
                ),
                "recommended_inference_mode": raw.get(
                    "recommendedInferenceMode", raw.get("recommended_inference_mode")
                ),
            }
            source_defaults = SOURCE_DEFAULTS.get(normalized["source_label"])
            if source_defaults is None:
                self._provenance_invalid = True
                continue
            provenance_mismatch = any(
                normalized[key] is not None and normalized[key] != expected
                for key, expected in source_defaults.items()
            )
            if provenance_mismatch:
                self._provenance_invalid = True
                continue
            for key, value in source_defaults.items():
                normalized[key] = value
            try:
                result.append(Scenario.model_validate(normalized))
            except ValueError:
                continue
        return result
