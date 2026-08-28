import type { components } from "./api-schema";
import { formatFaultCandidate, localizeIndustrialCopy } from "./presentation";

type EventDetail = components["schemas"]["EventDetail"];

const evidenceNames = (event: EventDetail) =>
  event.evidence.map((item) => `${item.variableId} ${localizeIndustrialCopy(item.variableName)}`);

export function answerEventQuestion(event: EventDetail, question: string): string {
  const candidate = event.candidates[0] ? formatFaultCandidate(event.candidates[0]).label : "当前故障候选";
  const evidence = evidenceNames(event);
  const normalized = question.trim();

  if (/传感器|仪表|测点/.test(normalized)) {
    const directionLabels = event.evidence.map((item) => `${item.variableId}${item.direction === "up" ? "上升" : "下降"}`);
    const directionSet = new Set(event.evidence.map((item) => item.direction));
    const directionSummary = directionSet.size === 1
      ? `变化方向一致（${directionLabels.join("、")}）`
      : `变化方向并不相同（${directionLabels.join("、")}）`;
    return `当前证据不足以完全排除传感器故障。之所以暂不把它排在首位，是因为 ${evidence.join("、")} 在同一时间窗内共同变化，${directionSummary}，并非只有一个测点跳变。当前首要假设是“${candidate}”，仍需现场核对仪表状态后才能确认。`;
  }
  if (/不处理|不处置|先不管|风险/.test(normalized)) {
    return `若暂不处理，${localizeIndustrialCopy(event.recommendation.risk)} 建议继续锁存告警，并在 10 分钟内完成首轮核对；这不是自动停车指令。`;
  }
  if (/10分钟|十分钟|检查顺序|怎么查/.test(normalized)) {
    const checks = event.recommendation.checks.slice(0, 3).map(localizeIndustrialCopy);
    return `10 分钟检查顺序：1）${checks[0] ?? "核对关键测点"}；2）${checks[1] ?? "检查执行机构反馈"}；3）${checks[2] ?? "确认公用工程波动"}。每一步结果都应由当班人员确认并留痕。`;
  }
  return `结合样本 ${event.detectionSample}—${event.diagnosisSample} 的证据，当前首要假设是“${candidate}”。最关键的依据是 ${evidence.join("、")}；建议先完成现场核对，再决定是否执行处置。`;
}

export const writebackPreviewSteps = [
  "人工确认拟议动作",
  "校验操作者权限",
  "校验工艺联锁与上下限",
  "生成控制网关指令草案",
  "等待二次确认后才允许发送",
] as const;
