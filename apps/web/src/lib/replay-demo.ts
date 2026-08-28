export const REPLAY_TICK_MS = 250;
export const REPLAY_TOTAL_SAMPLES = 500;

export interface ReplaySignalDefinition {
  id: string;
  name: string;
  unit: string;
  base: number;
  amplitude: number;
  driftRate: number;
}

const signalProfiles: Record<number, ReplaySignalDefinition[]> = {
  1: [
    { id: "XMEAS(20)", name: "压缩机功率", unit: "kW", base: 341, amplitude: 0.45, driftRate: -0.035 },
    { id: "XMEAS(16)", name: "汽提塔压力", unit: "kPa", base: 3010, amplitude: 1.8, driftRate: 0.12 },
    { id: "XMV(5)", name: "压缩机循环阀开度", unit: "%", base: 22.4, amplitude: 0.18, driftRate: -0.018 },
  ],
  4: [
    { id: "XMEAS(9)", name: "反应器温度", unit: "°C", base: 120.1, amplitude: 0.08, driftRate: 0.008 },
    { id: "XMEAS(21)", name: "冷却水出口温度", unit: "°C", base: 94.8, amplitude: 0.12, driftRate: 0.018 },
    { id: "XMV(10)", name: "冷却水流量阀开度", unit: "%", base: 54.2, amplitude: 0.3, driftRate: 0.045 },
  ],
  6: [
    { id: "XMEAS(1)", name: "A 进料流量", unit: "kscmh", base: 0.25, amplitude: 0.002, driftRate: -0.0012 },
    { id: "XMV(3)", name: "A 进料流量（物流 1）", unit: "%", base: 22.1, amplitude: 0.16, driftRate: 0.035 },
    { id: "XMEAS(20)", name: "压缩机功率", unit: "kW", base: 341, amplitude: 0.45, driftRate: -0.028 },
  ],
  13: [
    { id: "XMEAS(22)", name: "分离器冷却水出口温度", unit: "°C", base: 94.2, amplitude: 0.1, driftRate: 0.015 },
    { id: "XMV(6)", name: "放空阀开度", unit: "%", base: 40.1, amplitude: 0.2, driftRate: -0.022 },
    { id: "XMEAS(11)", name: "产品分离器温度", unit: "°C", base: 80.1, amplitude: 0.08, driftRate: -0.01 },
  ],
};

export function getReplaySignalDefinitions(faultId: number): ReplaySignalDefinition[] {
  return signalProfiles[faultId] ?? [];
}

export function normalizeReplaySpeed(speed: number): 1 | 5 | 10 | 20 {
  if (speed === 1 || speed === 5 || speed === 20) return speed;
  return 10;
}

export function advanceReplaySample(currentSample: number, speed: 1 | 5 | 10 | 20, totalSamples = REPLAY_TOTAL_SAMPLES) {
  const increment = Math.max(1, Math.round(speed / 2));
  return Math.min(totalSamples, currentSample + increment);
}

export function describeReplayStage(currentSample: number, faultOnsetSample: number, eventSample: number) {
  if (currentSample < faultOnsetSample) {
    return { state: "normal" as const, title: "正常基线", detail: "AI 正在读取 52 路过程变量，当前未发现持续偏移。" };
  }
  if (currentSample < eventSample) {
    return { state: "watching" as const, title: "偏移核验中", detail: "变量开始偏离基线，AI 正在排除瞬时噪声。" };
  }
  if (currentSample < eventSample + 20) {
    return { state: "alert" as const, title: "异常已锁定", detail: "持续性条件已满足，正在刷新故障候选和变量贡献。" };
  }
  return { state: "ready" as const, title: "原因与建议已生成", detail: "AI 已对齐证据，等待当班人员追问和确认。" };
}

export function createReplayTelemetry(currentSample: number, faultOnsetSample: number, faultId = 4) {
  const drift = Math.max(0, currentSample - faultOnsetSample);
  const wave = Math.sin(currentSample / 9);
  return getReplaySignalDefinitions(faultId).map((signal) => ({
    id: signal.id,
    name: signal.name,
    value: signal.base + wave * signal.amplitude + drift * signal.driftRate,
    unit: signal.unit,
  }));
}
