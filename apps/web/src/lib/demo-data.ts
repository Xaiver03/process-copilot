import type { components } from "./api-schema";

export type EventDetail = components["schemas"]["EventDetail"];
export type DecisionRecord = components["schemas"]["DecisionRecord"];
export type Scenario = components["schemas"]["Scenario"];
export type ReplayRun = components["schemas"]["ReplayRun"];
export type AnomalyEvent = components["schemas"]["AnomalyEvent"];

export const demoScenario: Scenario = {
  id: "uci-wtp-effluent-cod-risk",
  name: "出水 COD 风险预判",
  description: "基于公开污水处理传感器记录，按文件行序预测下一条出水 COD，用于演示下一化验周期风险。",
  faultId: 0,
  sampleCount: 101,
  faultOnsetSample: 42,
  sourceLabel: "UCI Water Treatment Plant public sensor data",
  domain: "wastewater",
  modelFamily: "uci-wtp-rf-softsensor",
  sampleIntervalSeconds: 86400,
  recommendedInferenceMode: "template",
};

export const demoEvent: EventDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  sampleIndex: 42,
  severity: "warning",
  state: "open",
  anomalyScore: 0.31,
  detectionSample: 42,
  diagnosisSample: 42,
  diagnosisDelaySamples: 0,
  diagnosisState: "updated",
  diagnosisAnomalyScore: 0.31,
  anomalyLatched: true,
  initialCandidates: [
    { faultId: 1, label: "初沉池出口 pH 偏离（核查权重）", probability: 0.407 },
    { faultId: 2, label: "进水 pH 偏离（核查权重）", probability: 0.407 },
    { faultId: 3, label: "进水流量偏离（核查权重）", probability: 0.186 },
  ],
  candidates: [
    { faultId: 1, label: "初沉池出口 pH 偏离（核查权重）", probability: 0.407 },
    { faultId: 2, label: "进水 pH 偏离（核查权重）", probability: 0.407 },
    { faultId: 3, label: "进水流量偏离（核查权重）", probability: 0.186 },
  ],
  evidence: [
    {
      variableId: "PH-P",
      variableName: "初沉池出口 pH",
      unit: "pH",
      contribution: 1,
      direction: "mixed",
      summary: "相对训练中位数/IQR 的绝对偏离约 1.00；仅作为检查优先级证据，不代表已证实因果。",
      values: [7.7, 7.6, 7.8, 7.4, 7.6],
    },
    {
      variableId: "PH-E",
      variableName: "进水 pH",
      unit: "pH",
      contribution: 1,
      direction: "mixed",
      summary: "相对训练中位数/IQR 的绝对偏离约 1.00；仅作为检查优先级证据，不代表已证实因果。",
      values: [7.8, 7.5, 7.6, 7.2, 7.5],
    },
    {
      variableId: "Q-E",
      variableName: "进水流量",
      unit: "m³/day",
      contribution: 0.455,
      direction: "mixed",
      summary: "相对训练中位数/IQR 的绝对偏离约 0.455；仅作为检查优先级证据，不代表已证实因果。",
      values: [33239, 32100, 32538, 35571, 33210],
    },
  ],
  recommendation: {
    mode: "template",
    risk: "预测中心值 117.45 mg/L 低于训练段历史高位边界 147.0 mg/L，但不确定区间上界 157.49 mg/L 跨过该边界，因此标记为关注级。",
    checks: ["优先复核 PH-P、PH-E 与 Q-E 的仪表状态、取样时间和最近趋势。", "核对后续化验结果与采样链路；上述偏离用于检查排序，不构成已证实因果。", "确认该历史高位边界为训练段 DQO-S P95，而非法律排放限值。"],
    actions: ["记录软测量预测并由操作员确认是否升级人工复核。", "按现场批准的操作规程处理，不执行自动控制写回。"],
    safetyBoundary: "Read-only advice. No automatic control write-back.",
  },
  modelVersion: "uci-wtp-rf-softsensor-5e5ff4f8",
  dataSourceDisclosure: "Public UCI wastewater sensor data, not real Guizhou plant data.",
  prediction: {
    targetId: "DQO-S",
    targetName: "出水化学需氧量",
    unit: "mg/L",
    horizonSamples: 1,
    horizonLabel: "下一化验周期",
    predictedValue: 117.45,
    observedValue: null,
    historicalHighBoundary: 147,
    uncertaintyMae: 33.93930693069307,
    lowerBound: 40.13,
    upperBound: 157.49,
    riskLevel: "elevated",
    boundaryBasis: "训练段 DQO-S P95，不是法律排放限值。",
  },
};

export const demoRun: ReplayRun = {
  id: "22222222-2222-4222-8222-222222222222",
  scenarioId: demoScenario.id,
  state: "paused",
  speed: 10,
  currentSample: 0,
  createdAt: "2026-08-28T08:20:00+08:00",
  inferenceMode: "template",
  modelVersion: "uci-wtp-rf-softsensor-5e5ff4f8",
};

export const demoEvents: AnomalyEvent[] = [
  demoEvent,
  {
    id: "44444444-4444-4444-8444-444444444444",
    runId: demoRun.id,
    sampleIndex: 55,
    severity: "warning",
    state: "confirmed",
    anomalyScore: 0.63,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    runId: demoRun.id,
    sampleIndex: 76,
    severity: "warning",
    state: "rejected",
    anomalyScore: 0.58,
  },
];

export const demoRecord: DecisionRecord = {
  id: "33333333-3333-4333-8333-333333333333",
  eventId: demoEvent.id,
  decision: "confirm",
  operatorName: "王工",
  note: "复核 PH-P、PH-E 与 Q-E 的仪表状态，等待后续化验结果。",
  createdAt: "2026-08-28T08:36:00+08:00",
  modelVersion: demoEvent.modelVersion,
  traceId: "demo-trace-static-001",
};
