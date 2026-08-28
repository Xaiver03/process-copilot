import { describe, expect, it } from "vitest";

import {
  eventSeverityPresentation,
  eventStateLabel,
  formatContribution,
  formatEvidenceSummary,
  formatFaultCandidate,
  localizeIndustrialCopy,
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

  it("将 TEP 公开故障标签翻译为现场可读中文", () => {
    expect(formatFaultCandidate({ faultId: 1, label: "Feed composition step deviation", probability: 1 })).toEqual({
      code: "IDV 1",
      label: "进料组成阶跃偏移",
      probability: "100%",
    });
    expect(formatFaultCandidate({ faultId: 13, label: "Reaction kinetics slow drift", probability: 0.42 })).toEqual({
      code: "IDV 13",
      label: "反应动力学缓慢漂移",
      probability: "42%",
    });
  });

  it("将公开数据中的英文变量与建议转为中文展示", () => {
    expect(localizeIndustrialCopy("Compressor Work")).toBe("压缩机功率");
    expect(localizeIndustrialCopy("Compare stream 4 composition analysis with the current operating target.")).toBe("对照当前运行目标，核对 4 号物流的组成分析结果。");
    expect(formatEvidenceSummary({
      variableId: "XMEAS(20)",
      variableName: "Compressor Work",
      direction: "down",
      contribution: 75.270465,
      summary: "upstream English copy",
      unit: "kW",
      values: [340, 330],
    })).toBe("压缩机功率相对正常基线下降；SPE 贡献值 75.27。");
  });

  it("SPE 贡献值保持原始量纲，不误当百分比", () => {
    expect(formatContribution(75.270465)).toBe("75.27");
    expect(formatContribution(0.36)).toBe("0.36");
    expect(formatContribution(12)).toBe("12");
  });
});
