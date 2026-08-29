import type { components } from "./api-schema";
import { formatFaultCandidate, localizeIndustrialCopy } from "./presentation";

type EventDetail = components["schemas"]["EventDetail"];

const evidenceNames = (event: EventDetail) =>
  event.evidence.map((item) => `${item.variableId} ${localizeIndustrialCopy(item.variableName)}`);

export function answerEventQuestion(event: EventDetail, question: string): string {
  const candidate = event.candidates[0]
    ? event.prediction ? event.candidates[0].label : formatFaultCandidate(event.candidates[0]).label
    : "当前故障候选";
  const evidence = evidenceNames(event);
  const normalized = question.trim();

  if (event.prediction) {
    const prediction = event.prediction;
    if (/关注|不确定区间|预测原因/.test(normalized)) {
      return `预测中心值 ${prediction.predictedValue.toFixed(2)} ${prediction.unit} 低于历史高位边界 ${prediction.historicalHighBoundary.toFixed(2)} ${prediction.unit}，但不确定区间上界 ${prediction.upperBound.toFixed(2)} ${prediction.unit} 已跨过边界，因此进入关注级。这是风险提示，不是已超标的实测结论。`;
    }
    if (/限值|法规|排放标准|边界/.test(normalized)) {
      return `${prediction.boundaryBasis}它用于演示历史工况的高位风险，不能替代现场许可证限值、实测化验或合规判定。`;
    }
    if (/三项|变量|怎么查|检查顺序|核对/.test(normalized)) {
      return `建议按顺序核对：1）${evidence[0] ?? "首个过程变量"}；2）${evidence[1] ?? "第二个过程变量"}；3）${evidence[2] ?? "第三个过程变量"}。这个顺序来自训练中位数/IQR 偏离幅度，不代表已证实因果。`;
    }
  }

  if (/传感器|仪表|测点/.test(normalized)) {
    const directionText = { up: "上升", down: "下降", mixed: "波动方向混合" } as const;
    const directionLabels = event.evidence.map((item) => `${item.variableId}${directionText[item.direction]}`);
    const directionSet = new Set(event.evidence.map((item) => item.direction));
    const directionSummary = directionSet.size === 1 && !directionSet.has("mixed")
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
