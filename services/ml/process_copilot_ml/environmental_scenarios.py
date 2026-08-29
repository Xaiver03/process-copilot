"""Illustrative environmental scenarios for the Xifeng phosphorus-coal park report.

This module is deliberately separate from the TEP-based build pipeline in
``build.py``: the Tennessee Eastman Process artifacts are built from a real
public simulation dataset with a strict provenance guard (see
``process_copilot_api.catalog.DataCatalog``). The scenarios generated here are
synthetic and illustrative only, produced to demonstrate the AI application
ideas in the Xifeng park report (交椅山磷石膏渣库渗滤液早期预警,
report §4.1/§4.4-5), for which no real sensor data has been obtained yet
(report §"现状边界与下一步"). They must never be merged into the TEP catalog
or presented as verified Xifeng park telemetry.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

SOURCE_LABEL = (
    "Synthetic illustrative scenario derived from public Xifeng park EIA and "
    "regulatory disclosures; not real sensor data."
)

# 息烽河流域总磷特别排放限值，见省级生态环境厅通告（报告 3.2 节“漏洞二”引用）。
TOTAL_PHOSPHORUS_LIMIT_MG_L = 0.3

DAYS = 180
BASELINE_DAYS = 120
DRIFT_START_DAY = 120
BREACH_RAMP_START_DAY = 158
SUSTAINED_DAYS_REQUIRED = 5
LEADING_SIGMA_THRESHOLD = 4.0


@dataclass(frozen=True)
class EnvironmentalVariableSpec:
    variable_id: str
    variable_name: str
    unit: str
    monitoring_point: str
    leading_indicator: bool

    def to_json(self) -> dict[str, Any]:
        return {
            "variableId": self.variable_id,
            "variableName": self.variable_name,
            "unit": self.unit,
            "monitoringPoint": self.monitoring_point,
            "leadingIndicator": self.leading_indicator,
        }


VARIABLES: tuple[EnvironmentalVariableSpec, ...] = (
    EnvironmentalVariableSpec(
        "membrane_anomaly_score",
        "防渗膜异常置信度（机器视觉，对应 HJ 1480-2026 视频异常检测报警类型）",
        "score(0-1)",
        "交椅山渣库西侧边坡",
        True,
    ),
    EnvironmentalVariableSpec(
        "conductivity_us_cm",
        "渗滤液电导率",
        "uS/cm",
        "库底导渗盲沟集水池",
        True,
    ),
    EnvironmentalVariableSpec(
        "slope_displacement_mm",
        "边坡累计位移",
        "mm",
        "交椅山渣库西侧边坡",
        True,
    ),
    EnvironmentalVariableSpec(
        "leachate_level_m",
        "渗滤液集水池水位",
        "m",
        "库底导渗盲沟集水池",
        False,
    ),
    EnvironmentalVariableSpec(
        "ph",
        "渗滤液 pH",
        "pH",
        "库底导渗盲沟集水池",
        False,
    ),
    EnvironmentalVariableSpec(
        "total_phosphorus_mg_l",
        "总磷浓度（泉点出露，桂花泉）",
        "mg/L",
        "桂花泉",
        False,
    ),
)

CITATIONS: tuple[dict[str, str], ...] = (
    {
        "label": "交椅山磷石膏库西侧边坡及三区东段覆土复绿项目环境影响报告书公众参与说明（贵阳开磷化肥有限公司，2025）",
        "detail": "防渗膜老化、排水沟渠淤堵渗漏、雨污未分流的现状描述，是本场景防渗膜异常与渗滤液早期漂移设定的依据。",
    },
    {
        "label": "息烽县磷煤化工生态工业基地总体规划环境影响评价报告书简本（息烽县人民政府，2022）第2.5节",
        "detail": "2017年环保督查发现渗漏经泉点出露、企业分五期治理、2020-2021年仍出现渗漏点的事实时间线。",
    },
    {
        "label": "HJ 1480-2026《排污单位自行监测视频监控系统建设与联网技术要求》（生态环境部，2026-07-22发布，2026-10-01实施）",
        "detail": "视频异常检测报警类型编码，是本场景“防渗膜异常置信度”变量对应的标准化数据来源设计依据。",
    },
)


def _drift_ramp(days: np.ndarray, start_day: int, span: int, power: float) -> np.ndarray:
    ramp = np.clip((days - start_day) / span, 0.0, None)
    return ramp**power


def generate_series(seed: int = 42, days: int = DAYS) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    day_index = np.arange(days)
    span = max(days - DRIFT_START_DAY, 1)
    membrane_drift = _drift_ramp(day_index, DRIFT_START_DAY, span, 1.6)
    breach_drift = _drift_ramp(day_index, BREACH_RAMP_START_DAY, max(days - BREACH_RAMP_START_DAY, 1), 2.2)

    membrane_anomaly_score = np.clip(
        rng.normal(0.05, 0.01, days) + 0.85 * membrane_drift, 0.0, 1.0
    )
    conductivity_us_cm = rng.normal(950.0, 20.0, days) + 650.0 * membrane_drift
    slope_displacement_mm = np.cumsum(rng.normal(0.02, 0.01, days)) + 6.0 * membrane_drift
    leachate_level_m = rng.normal(3.2, 0.05, days) + 0.4 * membrane_drift
    ph = rng.normal(7.6, 0.05, days) - 0.5 * membrane_drift
    total_phosphorus_mg_l = np.clip(rng.normal(0.08, 0.01, days) + 0.55 * breach_drift, 0.0, None)

    return {
        "membrane_anomaly_score": membrane_anomaly_score,
        "conductivity_us_cm": conductivity_us_cm,
        "slope_displacement_mm": slope_displacement_mm,
        "leachate_level_m": leachate_level_m,
        "ph": ph,
        "total_phosphorus_mg_l": total_phosphorus_mg_l,
    }


def _first_sustained_breach(values: np.ndarray, threshold: float, sustained_days: int) -> int | None:
    above = values > threshold
    run = 0
    for index, flag in enumerate(above):
        run = run + 1 if flag else 0
        if run >= sustained_days:
            return index - sustained_days + 1
    return None


def detect_early_warning(series: dict[str, np.ndarray]) -> dict[str, Any]:
    total_phosphorus = series["total_phosphorus_mg_l"]
    breach_day = _first_sustained_breach(total_phosphorus, TOTAL_PHOSPHORUS_LIMIT_MG_L, 1)
    breach_variable_id = "total_phosphorus_mg_l"

    best_warning_day: int | None = None
    best_variable_id: str | None = None
    for spec in VARIABLES:
        if not spec.leading_indicator:
            continue
        values = series[spec.variable_id]
        baseline = values[:BASELINE_DAYS]
        mean, std = float(np.mean(baseline)), float(np.std(baseline))
        threshold = mean + LEADING_SIGMA_THRESHOLD * max(std, 1e-9)
        warning_day = _first_sustained_breach(values, threshold, SUSTAINED_DAYS_REQUIRED)
        if warning_day is None:
            continue
        if best_warning_day is None or warning_day < best_warning_day:
            best_warning_day = warning_day
            best_variable_id = spec.variable_id

    triggered = best_warning_day is not None and breach_day is not None
    lead_time_days = (breach_day - best_warning_day) if triggered else None
    if triggered and lead_time_days is not None and lead_time_days > 0:
        summary = (
            f"第 {best_warning_day} 天，{best_variable_id} 率先偏离基线并持续 "
            f"{SUSTAINED_DAYS_REQUIRED} 天以上；总磷在第 {breach_day} 天于泉点突破 "
            f"{TOTAL_PHOSPHORUS_LIMIT_MG_L} mg/L 特别排放限值——提前 {lead_time_days} 天可发出预警，"
            "而不是等泉点超标后才发现（对应报告 3.2 节“漏洞二”）。"
        )
    else:
        summary = "本次生成序列未形成有效的提前预警窗口，请检查随机种子或漂移参数设置。"
    return {
        "triggered": bool(triggered),
        "warningDay": best_warning_day,
        "warningVariableId": best_variable_id,
        "breachDay": breach_day,
        "breachVariableId": breach_variable_id,
        "leadTimeDays": lead_time_days,
        "summary": summary,
    }


def _round_series(values: np.ndarray, decimals: int = 4) -> list[float]:
    return [round(float(value), decimals) for value in values]


def build_jiaoyishan_leachate_scenario(output_dir: Path, seed: int = 42) -> dict[str, Path]:
    scenario_dir = output_dir / "xifeng-jiaoyishan-leachate"
    scenario_dir.mkdir(parents=True, exist_ok=True)

    series = generate_series(seed=seed)
    early_warning = detect_early_warning(series)

    scenario_payload = {
        "id": "xifeng-jiaoyishan-leachate",
        "name": "交椅山磷石膏渣库渗滤液早期预警（示意）",
        "description": (
            "对应报告《贵阳息烽磷煤化工园区工艺体系分析及AI赋能应用思路》4.4节场景(5)："
            "以合成示意数据演示——若能在防渗膜异常、电导率、边坡位移等先导指标出现持续偏离时"
            "即发出预警，理论上可在总磷于泉点出露超标之前完成拦截，而不是像2017年环保督查记录"
            "的那样，等污染物运移至泉点出露、总磷超标之后才发现。"
        ),
        "monitoringPoints": sorted({spec.monitoring_point for spec in VARIABLES}),
        "regulatoryLimitLabel": "息烽河流域总磷特别排放限值",
        "regulatoryLimitValue": TOTAL_PHOSPHORUS_LIMIT_MG_L,
        "regulatoryLimitUnit": "mg/L",
        "variables": [spec.to_json() for spec in VARIABLES],
        "sourceLabel": SOURCE_LABEL,
        "citations": list(CITATIONS),
    }
    telemetry_payload = {
        "dayIndex": list(range(len(next(iter(series.values()))))),
        "series": {key: _round_series(values) for key, values in series.items()},
    }

    # Named to avoid DataCatalog._manifest_candidates() picking this up via its
    # recursive "scenario.json" glob under data/processed (see catalog.py).
    scenario_path = scenario_dir / "environmental_scenario.json"
    telemetry_path = scenario_dir / "telemetry.json"
    warning_path = scenario_dir / "early_warning.json"
    scenario_path.write_text(
        json.dumps(scenario_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    telemetry_path.write_text(
        json.dumps(telemetry_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    warning_path.write_text(
        json.dumps(early_warning, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "scenario": scenario_path,
        "telemetry": telemetry_path,
        "early_warning": warning_path,
    }


def build_environmental_scenarios(output_dir: Path, seed: int = 42) -> list[dict[str, Path]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    return [build_jiaoyishan_leachate_scenario(output_dir, seed=seed)]
