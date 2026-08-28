import { describe, expect, it } from "vitest";

import { createProcessHeatmapData, createProcessHeatmapOption } from "@/lib/chart-options";

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
});
