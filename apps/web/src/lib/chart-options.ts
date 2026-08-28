import type { EChartsOption } from "echarts";
import type { components } from "./api-schema";

type EvidenceItem = components["schemas"]["EvidenceItem"];

export const processVariables = [
  ...Array.from({ length: 41 }, (_, index) => `XMEAS(${index + 1})`),
  ...Array.from({ length: 11 }, (_, index) => `XMV(${index + 1})`),
];

export type ProcessHeatmapPoint = [sample: string, variableIndex: number, intensity: number];

export function createProcessHeatmapData(
  currentSample = 500,
  faultOnsetSample = 160,
  totalSamples = 500,
): ProcessHeatmapPoint[] {
  const visibleSample = Math.max(0, Math.min(currentSample, totalSamples));
  const samplePoints = Array.from({ length: Math.floor(visibleSample / 10) + 1 }, (_, index) => index * 10);
  const criticalVariableIndices = new Set([8, 20, 50]);
  return processVariables.flatMap((_, variableIndex) =>
    samplePoints.map((sample) => {
      const baseline = 0.1 + Math.abs(Math.sin(sample / 26 + variableIndex / 7)) * 0.18;
      const eventProgress = Math.max(0, Math.min(1, (sample - faultOnsetSample) / 40));
      const eventLift = sample >= faultOnsetSample && criticalVariableIndices.has(variableIndex)
        ? 0.35 + eventProgress * 0.45
        : 0;
      return [String(sample), variableIndex, Number(Math.min(1, baseline + eventLift).toFixed(2))] as ProcessHeatmapPoint;
    }),
  );
}

export function createProcessHeatmapOption(
  currentSample = 500,
  faultOnsetSample = 160,
  totalSamples = 500,
): EChartsOption & { series: Array<{ type: string; markLine?: unknown; markArea?: unknown }> } {
  const xAxisSamples = Array.from({ length: Math.floor(totalSamples / 10) + 1 }, (_, index) => String(index * 10));
  return {
    animation: false,
    tooltip: { position: "top", formatter: (params: unknown) => {
      const value = (params as { value: [string, number, number] }).value;
      return `${processVariables[value[1]]}<br/>样本 ${value[0]}<br/>偏移强度 ${value[2].toFixed(2)}`;
    } },
    grid: { left: 82, right: 24, top: 16, bottom: 42 },
    xAxis: { type: "category", data: xAxisSamples, name: "样本" },
    yAxis: { type: "category", data: processVariables, axisLabel: { interval: 4, fontFamily: "monospace" } },
    visualMap: {
      min: 0,
      max: 1,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: ["#d8e9f3", "#b9d5e4", "#3996ae", "#f2a93b", "#de5b6d"] },
    },
    series: [{
      type: "heatmap",
      data: createProcessHeatmapData(currentSample, faultOnsetSample, totalSamples),
      progressive: 4000,
      emphasis: { itemStyle: { borderColor: "#102a3a", borderWidth: 1 } },
      markLine: {
        silent: true,
        symbol: "none",
        label: { formatter: `故障注入 ${faultOnsetSample}`, color: "#a52f42", fontWeight: 700 },
        lineStyle: { color: "#de5b6d", width: 2, type: "dashed" },
        data: [{ name: "故障注入", xAxis: String(faultOnsetSample) }],
      },
      markArea: {
        silent: true,
        label: { color: "#627987", fontWeight: 700 },
        itemStyle: { color: "rgba(98, 121, 135, 0.12)" },
        data: [[{ name: "尚未回放", xAxis: String(Math.min(currentSample, totalSamples)) }, { xAxis: String(totalSamples) }]],
      },
    }],
  };
}

export function createEvidenceTrendOption(evidence: EvidenceItem[]): EChartsOption & {
  grid: Array<Record<string, unknown>>;
  series: Array<{ type: string }>;
} {
  const items = evidence.slice(0, 3);
  const positions = [6, 36, 66];
  return {
    animation: false,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: { trigger: "axis" },
    grid: positions.map((top) => ({ left: 76, right: 18, top: `${top}%`, height: "23%" })),
    xAxis: items.map((_, index) => ({
      type: "category",
      gridIndex: index,
      data: Array.from({ length: 36 }, (_, sample) => String(140 + sample * 2)),
      axisLabel: { show: index === 2 },
      axisTick: { show: false },
    })),
    yAxis: items.map((item, index) => ({
      type: "value",
      gridIndex: index,
      name: `${item.variableId} ${item.unit}`,
      nameLocation: "middle",
      nameGap: 48,
      splitLine: { lineStyle: { color: "#dceaf5" } },
    })),
    series: items.map((item, index) => ({
      type: "line",
      name: item.variableName,
      xAxisIndex: index,
      yAxisIndex: index,
      data: item.values,
      showSymbol: false,
      lineStyle: { color: index === 0 ? "#24839b" : index === 1 ? "#13c2c2" : "#627987", width: 2, type: index === 2 ? "dashed" : "solid" },
      markArea: { silent: true, itemStyle: { color: "rgba(242, 169, 59, 0.14)" }, data: [[{ xAxis: "160" }, { xAxis: "210" }]] },
    })),
  };
}
