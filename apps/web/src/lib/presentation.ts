import type { components } from "./api-schema";

type AnomalyEvent = components["schemas"]["AnomalyEvent"];
type FaultCandidate = components["schemas"]["FaultCandidate"];
type EvidenceItem = components["schemas"]["EvidenceItem"];
type Scenario = components["schemas"]["Scenario"];
type PredictionRiskLevel = NonNullable<components["schemas"]["EventDetail"]["prediction"]>["riskLevel"];

const tepFaultLabelZh: Partial<Record<number, string>> = {
  1: "进料组成阶跃偏移",
  4: "反应器冷却水入口温度阶跃",
  6: "A 进料中断",
  13: "反应动力学缓慢漂移",
};

export function formatScenarioPresentation(scenario: Scenario) {
  if (scenario.domain === "wastewater") {
    return {
      name: "污水出水风险预判",
      description: `基于污水时序传感器数据，预测下一化验周期的出水风险；共 ${scenario.sampleCount} 个样本。`,
      source: "UCI 污水处理厂公开传感器数据",
    };
  }

  const localizedName = tepFaultLabelZh[scenario.faultId]
    ?? (/[㐀-鿿]/.test(scenario.name) ? scenario.name : `连续过程故障 ${scenario.faultId}`);
  return {
    name: `${localizedName}（故障 ${scenario.faultId}）`,
    description: `田纳西-伊士曼过程（TEP）公开仿真；故障从样本 ${scenario.faultOnsetSample} 注入，共 ${scenario.sampleCount} 个样本。`,
    source: "田纳西-伊士曼过程（TEP）公开仿真数据",
  };
}

const industrialCopyZh: Record<string, string> = {
  "Compressor Work": "压缩机功率",
  "Stripper Pressure": "汽提塔压力",
  "Compressor Recycle Valve": "压缩机循环阀",
  "A Feed (stream 1)": "A 进料（物流 1）",
  "A Feed Flow (stream 1)": "A 进料流量（物流 1）",
  "Separator Cooling Water Outlet Temperature": "分离器冷却水出口温度",
  "Purge Valve (stream 9)": "放空阀（物流 9）",
  "Product Separator Temperature": "产品分离器温度",
  "Feed composition or A/C ratio may have shifted from its expected state.": "进料组成或 A/C 比可能已经偏离预期工况。",
  "Compare stream 4 composition analysis with the current operating target.": "对照当前运行目标，核对 4 号物流的组成分析结果。",
  "Verify feed analyzer freshness and recent laboratory results.": "核对进料分析仪数据新鲜度及近期化验结果。",
  "Review upstream feed changes with the field operator.": "与现场操作员复核上游进料变化。",
  "Record the evidence and request human confirmation.": "记录当前证据并请求人工确认。",
  "Follow the site's approved operating procedure if escalation is confirmed.": "如确认需要升级处理，按现场已批准的操作规程执行。",
  "A-feed availability may be reduced, affecting reactor material balance.": "A 进料供应可能下降，并影响反应器物料平衡。",
  "Verify A-feed flow indication and upstream supply status.": "核对 A 进料流量指示与上游供应状态。",
  "Check related valve position and controller output for disagreement.": "检查相关阀位反馈与控制器输出是否一致。",
  "Review reactor pressure and feed-rate trends with the shift engineer.": "与当班工程师复核反应器压力和进料速率趋势。",
  "A slow process-kinetics drift may be developing.": "过程反应动力学可能正在发生缓慢漂移。",
  "Compare reactor temperature and product composition against the recent baseline.": "将反应器温度和产品组成与近期基线对照。",
  "Review raw-material lot, catalyst and laboratory quality context.": "复核原料批次、催化剂及化验质量背景。",
  "Ask process engineering to assess the sustained drift before intervention.": "干预前请工艺工程师评估持续漂移。",
};

export const eventStateLabel: Record<AnomalyEvent["state"], string> = {
  open: "待研判",
  confirmed: "已确认",
  rejected: "已驳回",
  escalated: "已升级",
  resolved: "已自动恢复",
};

export const eventSeverityPresentation: Record<
  AnomalyEvent["severity"],
  { state: "warning" | "critical"; label: string }
> = {
  warning: { state: "warning", label: "偏移" },
  critical: { state: "critical", label: "严重" },
};

export function formatPredictionRisk(riskLevel: PredictionRiskLevel) {
  const presentation: Record<PredictionRiskLevel, { state: "normal" | "warning" | "critical"; label: string }> = {
    normal: { state: "normal", label: "正常" },
    elevated: { state: "warning", label: "需关注" },
    high: { state: "critical", label: "高风险" },
    unknown: { state: "warning", label: "未知 · 待人工确认" },
  };
  return presentation[riskLevel];
}

export function formatFaultCandidate(candidate: FaultCandidate) {
  if (candidate.faultId === 0) {
    return {
      code: "正常 / 未收敛",
      label: "正常 / 分类尚未收敛",
      probability: `${Math.round(candidate.probability * 100)}%`,
    };
  }
  return {
    code: `IDV ${candidate.faultId}`,
    label: tepFaultLabelZh[candidate.faultId] ?? candidate.label,
    probability: `${Math.round(candidate.probability * 100)}%`,
  };
}

export function formatContribution(value: number) {
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function localizeIndustrialCopy(value: string) {
  return industrialCopyZh[value] ?? value;
}

export function formatEvidenceSummary(evidence: EvidenceItem) {
  const direction = evidence.direction === "up" ? "上升" : evidence.direction === "down" ? "下降" : "呈混合变化";
  return `${localizeIndustrialCopy(evidence.variableName)}相对正常基线${direction}；SPE 贡献值 ${formatContribution(evidence.contribution)}。`;
}
