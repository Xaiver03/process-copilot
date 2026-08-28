export const REPLAY_TICK_MS = 250;
export const REPLAY_TOTAL_SAMPLES = 500;

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

export function createReplayTelemetry(currentSample: number, faultOnsetSample: number) {
  const drift = Math.max(0, currentSample - faultOnsetSample);
  const wave = Math.sin(currentSample / 9);
  return [
    { id: "XMEAS(9)", name: "反应器温度", value: 120.1 + wave * 0.08 + drift * 0.008, unit: "°C" },
    { id: "XMEAS(21)", name: "冷却水出口温度", value: 94.8 + wave * 0.12 + drift * 0.018, unit: "°C" },
    { id: "XMV(10)", name: "冷却水流量阀开度", value: 54.2 + wave * 0.3 + drift * 0.045, unit: "%" },
  ];
}
