import type { EChartsOption } from "echarts";
import type { components } from "./api-schema";

type EvidenceItem = components["schemas"]["EvidenceItem"];

export const processVariables = [
  ...Array.from({ length: 41 }, (_, index) => `XMEAS(${index + 1})`),
  ...Array.from({ length: 11 }, (_, index) => `XMV(${index + 1})`),
];

const heatmapData = processVariables.flatMap((_, variableIndex) =>
  Array.from({ length: 24 }, (_, timeIndex) => {
    const wave = Math.sin(timeIndex / 3 + variableIndex / 7) * 0.22;
    const eventLift = timeIndex > 15 && [8, 20, 45].includes(variableIndex) ? 0.58 : 0;
    return [timeIndex, variableIndex, Number(Math.min(1, Math.abs(wave) + eventLift).toFixed(2))];
  }),
);

export function createProcessHeatmapOption(): EChartsOption & { series: Array<{ type: string }> } {
  return {
    animation: false,
    tooltip: { position: "top", formatter: (params: unknown) => {
      const value = (params as { value: [number, number, number] }).value;
      return `${processVariables[value[1]]}<br/>样本 ${value[0] * 8}<br/>偏移强度 ${value[2].toFixed(2)}`;
    } },
    grid: { left: 82, right: 24, top: 16, bottom: 42 },
    xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => String(i * 8)), name: "样本" },
    yAxis: { type: "category", data: processVariables, axisLabel: { interval: 4, fontFamily: "monospace" } },
    visualMap: {
      min: 0,
      max: 1,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: ["#f7fbfe", "#dceaf5", "#3996ae", "#f2a93b", "#de5b6d"] },
    },
    series: [{ type: "heatmap", data: heatmapData, progressive: 2000, emphasis: { itemStyle: { borderColor: "#102a3a", borderWidth: 1 } } }],
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
