"""“以渣定产”园区物料平衡仿真（报告 3.2 节“漏洞三”、4.4 节场景(6)）。

纯规则计算，不训练/调用任何模型，也不缓存任何状态：磷石膏在二水法湿法磷酸
萃取阶段随总处理量产出（Ca5F(PO4)3 + H2SO4 反应），产出量与下游磷肥/净化
磷酸等支路如何分配磷酸无关；因此“以渣定产”约束的是全园区磷酸总处理量，
不是单条产线的负荷。本模块给定磷石膏消纳能力上限，计算请求总量是否超限，
超限时给出三种压减策略的可行负荷组合，供决策参考——不是自动下发的生产指令。

磷石膏产出系数 4-5 吨/吨 P2O5 的默认区间引用报告 2.1 节。所有产能、消纳上限
均为调用方传入，不是核实过的息烽园区真实产能数字。
"""

from __future__ import annotations

from .schemas import (
    CapacityLineRequest,
    CapacityLineResult,
    CapacityPlanOption,
    CapacityPlanRequest,
    CapacityPlanResponse,
)

DISCLOSURE = (
    "Illustrative material-balance calculator using report-cited phosphogypsum "
    "ratios; capacity and cap values are supplied by the caller, not verified "
    "Xifeng park production data."
)


def _allocate(
    lines: list[CapacityLineRequest], scale_by_line: dict[str, float]
) -> list[CapacityLineResult]:
    results: list[CapacityLineResult] = []
    for line in lines:
        scale = scale_by_line.get(line.id, 0.0)
        allocated = line.requested_p2o5_tpd * scale
        results.append(
            CapacityLineResult(
                id=line.id,
                name=line.name,
                requested_p2o5_tpd=line.requested_p2o5_tpd,
                allocated_p2o5_tpd=allocated,
                load_pct_of_request=scale * 100.0,
            )
        )
    return results


def _build_option(
    strategy: str,
    label: str,
    lines: list[CapacityLineRequest],
    scale_by_line: dict[str, float],
    ratio_low: float,
    ratio_high: float,
    cap: float,
) -> CapacityPlanOption:
    line_results = _allocate(lines, scale_by_line)
    total = sum(result.allocated_p2o5_tpd for result in line_results)
    gypsum_low = total * ratio_low
    gypsum_high = total * ratio_high
    utilization_pct = (gypsum_high / cap * 100.0) if cap > 0 else 0.0
    return CapacityPlanOption(
        strategy=strategy,
        label=label,
        total_allocated_p2o5_tpd=total,
        gypsum_output_low_tpd=gypsum_low,
        gypsum_output_high_tpd=gypsum_high,
        within_cap=gypsum_high <= cap + 1e-9,
        utilization_pct=utilization_pct,
        lines=line_results,
    )


def _priority_first_scale(
    lines: list[CapacityLineRequest], p2o5_budget: float
) -> dict[str, float]:
    ordered = sorted(lines, key=lambda line: (-line.priority, line.id))
    remaining = max(p2o5_budget, 0.0)
    scales: dict[str, float] = {}
    for line in ordered:
        if line.requested_p2o5_tpd <= 0:
            scales[line.id] = 0.0
            continue
        take = min(line.requested_p2o5_tpd, remaining)
        scales[line.id] = take / line.requested_p2o5_tpd
        remaining = max(remaining - take, 0.0)
    return scales


def _equal_share_scale(lines: list[CapacityLineRequest], p2o5_budget: float) -> dict[str, float]:
    if not lines:
        return {}
    share = max(p2o5_budget, 0.0) / len(lines)
    return {
        line.id: (min(1.0, share / line.requested_p2o5_tpd) if line.requested_p2o5_tpd > 0 else 0.0)
        for line in lines
    }


def simulate_capacity_plan(request: CapacityPlanRequest) -> CapacityPlanResponse:
    lines = request.lines
    ratio_low, ratio_high = sorted((request.gypsum_ratio_low, request.gypsum_ratio_high))
    cap = request.gypsum_cap_tpd

    total_requested = sum(line.requested_p2o5_tpd for line in lines)
    requested_low = total_requested * ratio_low
    requested_high = total_requested * ratio_high
    request_within_cap = requested_high <= cap + 1e-9

    full_scale = {line.id: 1.0 for line in lines}
    options = [
        _build_option(
            "proportional", "按请求全量运行（未受消纳能力约束）", lines, full_scale, ratio_low, ratio_high, cap
        )
    ]

    if not request_within_cap:
        conservative_budget = cap / ratio_high if ratio_high > 0 else 0.0

        proportional_scale = min(cap / requested_high, 1.0) if requested_high > 0 else 0.0
        options.append(
            _build_option(
                "proportional",
                "按比例统一压减至消纳能力上限内",
                lines,
                {line.id: proportional_scale for line in lines},
                ratio_low,
                ratio_high,
                cap,
            )
        )
        options.append(
            _build_option(
                "priority_first",
                "优先保供高优先级装置，压减其余装置",
                lines,
                _priority_first_scale(lines, conservative_budget),
                ratio_low,
                ratio_high,
                cap,
            )
        )
        options.append(
            _build_option(
                "equal_share",
                "各装置按消纳额度平均分摊",
                lines,
                _equal_share_scale(lines, conservative_budget),
                ratio_low,
                ratio_high,
                cap,
            )
        )

    return CapacityPlanResponse(
        gypsum_cap_tpd=cap,
        total_requested_p2o5_tpd=total_requested,
        requested_gypsum_output_low_tpd=requested_low,
        requested_gypsum_output_high_tpd=requested_high,
        request_within_cap=request_within_cap,
        options=options,
        disclosure=DISCLOSURE,
    )
