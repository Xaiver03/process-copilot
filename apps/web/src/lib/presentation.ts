import type { components } from "./api-schema";

type AnomalyEvent = components["schemas"]["AnomalyEvent"];
type FaultCandidate = components["schemas"]["FaultCandidate"];

export const eventStateLabel: Record<AnomalyEvent["state"], string> = {
  open: "待研判",
  confirmed: "已确认",
  rejected: "已驳回",
  escalated: "已升级",
};

export const eventSeverityPresentation: Record<
  AnomalyEvent["severity"],
  { state: "warning" | "critical"; label: string }
> = {
  warning: { state: "warning", label: "偏移" },
  critical: { state: "critical", label: "严重" },
};

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
    label: candidate.label,
    probability: `${Math.round(candidate.probability * 100)}%`,
  };
}

export function formatContribution(value: number) {
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
