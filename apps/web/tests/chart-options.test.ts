import { describe, expect, it } from "vitest";

import { createEvidenceTrendOption, createProcessHeatmapData, createProcessHeatmapOption } from "@/lib/chart-options";
import { demoEvent } from "@/lib/demo-data";

describe("过程回放热力图", () => {
  it("只生成当前样本之前的数据且正常基线不是空白", () => {
    const data = createProcessHeatmapData(120, 160, 500);
    expect(Math.max(...data.map((point) => Number(point[0])))).toBeLessThanOrEqual(120);
    expect(Math.min(...data.map((point) => point[2]))).toBeGreaterThan(0);
  });

  it("在样本160标记故障注入并把未来区标为尚未回放", () => {
    const option = createProcessHeatmapOption(120, 160, 500);
    const series = option.series[0] as {
      markLine: { data: Array<{ xAxis: string; name: string }> };
      markArea: { data: Array<Array<{ xAxis: string; name?: string }>> };
    };
    expect(series.markLine.data[0]).toMatchObject({ xAxis: "160", name: "故障注入" });
    expect(series.markArea.data[0]).toEqual([{ name: "尚未回放", xAxis: "120" }, { xAxis: "500" }]);
  });

  it("故障注入后关键变量偏移强度明显高于正常基线", () => {
    const data = createProcessHeatmapData(200, 160, 500);
    const before = data.find(([sample, variable]) => sample === "150" && variable === 20)?.[2] ?? 0;
    const after = data.find(([sample, variable]) => sample === "190" && variable === 20)?.[2] ?? 0;
    expect(after).toBeGreaterThan(before + 0.3);
  });

  it("按当前场景的证据变量而不是固定冷却水变量高亮", () => {
    const data = createProcessHeatmapData(200, 160, 500, ["XMEAS(1)", "XMV(3)", "XMEAS(20)"]);
    const feedBefore = data.find(([sample, variable]) => sample === "150" && variable === 0)?.[2] ?? 0;
    const feedAfter = data.find(([sample, variable]) => sample === "190" && variable === 0)?.[2] ?? 0;
    const coolingAfter = data.find(([sample, variable]) => sample === "190" && variable === 20)?.[2] ?? 0;
    expect(feedAfter).toBeGreaterThan(feedBefore + 0.3);
    expect(coolingAfter).toBeLessThan(feedAfter);
  });
});

describe("证据趋势时间轴", () => {
  it("污水预测按样本 42 对齐最近五条公开记录而不是沿用 TEP 固定轴", () => {
    const option = createEvidenceTrendOption(demoEvent.evidence, 42);
    const xAxis = option.xAxis as Array<{ data: string[] }>;
    const series = option.series as Array<{ markLine?: { data: Array<{ xAxis: string; name: string }> } }>;

    expect(xAxis[0].data).toEqual(["38", "39", "40", "41", "42"]);
    expect(series[0].markLine?.data[0]).toEqual({ name: "预测输入", xAxis: "42" });
    expect(xAxis[0].data).not.toContain("160");
  });
});
