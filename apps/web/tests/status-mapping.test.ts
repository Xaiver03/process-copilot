import { describe, expect, it } from "vitest";

import {
  eventSeverityPresentation,
  eventStateLabel,
  formatContribution,
  formatFaultCandidate,
} from "@/lib/presentation";

describe("事件与模型语义映射", () => {
  it("完整映射全部事件状态", () => {
    expect(eventStateLabel.open).toBe("待研判");
    expect(eventStateLabel.confirmed).toBe("已确认");
    expect(eventStateLabel.rejected).toBe("已驳回");
    expect(eventStateLabel.escalated).toBe("已升级");
  });

  it("完整映射 warning 和 critical 严重度", () => {
    expect(eventSeverityPresentation.warning).toEqual({ state: "warning", label: "偏移" });
    expect(eventSeverityPresentation.critical).toEqual({ state: "critical", label: "严重" });
  });

  it("fault candidate 0 显示正常或尚未收敛，不冒充故障真值", () => {
    expect(formatFaultCandidate({ faultId: 0, label: "IDV 0", probability: 0.52 })).toEqual({
      code: "正常 / 未收敛",
      label: "正常 / 分类尚未收敛",
      probability: "52%",
    });
  });

  it("SPE 贡献值保持原始量纲，不误当百分比", () => {
    expect(formatContribution(75.270465)).toBe("75.27");
    expect(formatContribution(0.36)).toBe("0.36");
    expect(formatContribution(12)).toBe("12");
  });
});
