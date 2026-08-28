import type { components } from "./api-schema";

export type EventDetail = components["schemas"]["EventDetail"];
export type DecisionRecord = components["schemas"]["DecisionRecord"];
export type Scenario = components["schemas"]["Scenario"];
export type ReplayRun = components["schemas"]["ReplayRun"];
export type AnomalyEvent = components["schemas"]["AnomalyEvent"];

const series = (base: number, amplitude: number) =>
  Array.from({ length: 36 }, (_, index) =>
    Number((base + Math.sin(index / 4) * amplitude + (index > 22 ? amplitude * 1.6 : 0)).toFixed(2)),
  );

export const demoScenario: Scenario = {
  id: "static-demo-cooling-water",
  name: "静态 Demo · 冷却水入口温度偏移",
  description: "公开 Tennessee Eastman Process 仿真场景，用于验证偏移发现到人工留痕链路。",
  faultId: 4,
  sampleCount: 500,
  faultOnsetSample: 160,
  sourceLabel: "Tennessee Eastman Process public simulation",
};

export const demoEvent: EventDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  sampleIndex: 160,
  severity: "critical",
  state: "open",
  anomalyScore: 1.12,
  detectionSample: 160,
  diagnosisSample: 180,
  diagnosisDelaySamples: 20,
  diagnosisState: "updated",
  diagnosisAnomalyScore: 66.34,
  anomalyLatched: true,
  initialCandidates: [
    { faultId: 0, label: "Normal operation", probability: 0.9999 },
    { faultId: 13, label: "Reaction kinetics slow drift", probability: 0.00006 },
    { faultId: 6, label: "A-feed loss", probability: 0.00004 },
  ],
  candidates: [
    { faultId: 4, label: "反应器冷却水入口温度阶跃", probability: 0.74 },
    { faultId: 11, label: "反应器冷却水入口温度随机变化", probability: 0.17 },
    { faultId: 5, label: "冷凝器冷却水入口温度阶跃", probability: 0.09 },
  ],
  evidence: [
    {
      variableId: "XMEAS(21)",
      variableName: "反应器冷却水出口温度",
      unit: "°C",
      contribution: 0.36,
      direction: "up",
      summary: "故障窗口开始后持续抬升，偏离正常基线。",
      values: series(94.8, 0.35),
    },
    {
      variableId: "XMV(10)",
      variableName: "反应器冷却水流量阀",
      unit: "%",
      contribution: 0.29,
      direction: "up",
      summary: "控制阀开度上升，但温度未恢复至基线。",
      values: series(54.2, 1.1),
    },
    {
      variableId: "XMEAS(9)",
      variableName: "反应器温度",
      unit: "°C",
      contribution: 0.21,
      direction: "up",
      summary: "反应器温度出现同步缓慢上行。",
      values: series(120.1, 0.22),
    },
  ],
  recommendation: {
    mode: "degraded",
    risk: "若冷却能力继续下降，反应器温度可能进一步偏离正常窗口。",
    checks: ["核对冷却水入口温度", "检查阀位反馈与实际开度", "确认循环水压力是否波动"],
    actions: ["通知现场巡检冷却水回路", "保持当前控制策略并提高监视频率", "由当班工程师判断是否暂缓当前批次"],
    safetyBoundary: "Read-only advice. No automatic control write-back.",
  },
  modelVersion: "tep-pca-classifier-demo-0.1",
  dataSourceDisclosure: "Public simulation data, not real Guizhou plant data.",
};

export const demoRun: ReplayRun = {
  id: "22222222-2222-4222-8222-222222222222",
  scenarioId: demoScenario.id,
  state: "paused",
  speed: 10,
  currentSample: 180,
  createdAt: "2026-08-28T08:20:00+08:00",
  inferenceMode: "template",
  modelVersion: "tep-pca-classifier-demo-0.1",
};

export const demoEvents: AnomalyEvent[] = [
  demoEvent,
  {
    id: "44444444-4444-4444-8444-444444444444",
    runId: demoRun.id,
    sampleIndex: 164,
    severity: "warning",
    state: "confirmed",
    anomalyScore: 0.63,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    runId: demoRun.id,
    sampleIndex: 219,
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
  note: "通知现场检查冷却水回路并保留当前批次。",
  createdAt: "2026-08-28T08:36:00+08:00",
  modelVersion: demoEvent.modelVersion,
  traceId: "demo-trace-static-001",
};
