"use client";

import dynamic from "next/dynamic";

import type { components } from "@/lib/api-schema";
import {
  createEvidenceTrendOption,
  createProcessHeatmapOption,
} from "@/lib/chart-options";
import { formatContribution } from "@/lib/presentation";

type EvidenceItem = components["schemas"]["EvidenceItem"];

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div className="chart-loading" role="status">正在加载图表</div>,
});

export function ProcessHeatmapChart({
  currentSample = 500,
  faultOnsetSample = 160,
  totalSamples = 500,
  evidenceVariables = [
    { id: "XMEAS(9)", name: "反应器温度" },
    { id: "XMEAS(21)", name: "冷却水出口温度" },
    { id: "XMV(10)", name: "冷却水流量阀开度" },
  ],
}: {
  currentSample?: number;
  faultOnsetSample?: number;
  totalSamples?: number;
  evidenceVariables?: Array<{ id: string; name: string }>;
} = {}) {
  return (
    <section className="chart-panel heatmap-panel" aria-labelledby="heatmap-title">
      <div className="section-heading">
        <div><span className="kicker">52 路变量总览</span><h2 id="heatmap-title">过程偏移热力图</h2></div>
        <span className="legend-copy"><i className="legend-normal" />正常 <i className="legend-drift" />偏移 <i className="legend-alarm" />严重</span>
      </div>
      <p className="sr-summary" role="status">样本 {faultOnsetSample} 前为正常基线，之后 {evidenceVariables.map((item) => item.id).join("、")} 的偏移强度明显上升；当前已回放到样本 {currentSample}。</p>
      <ReactECharts
        option={createProcessHeatmapOption(currentSample, faultOnsetSample, totalSamples, evidenceVariables.map((item) => item.id))}
        className="heatmap-chart desktop-chart"
        opts={{ renderer: "canvas" }}
        aria-hidden="true"
      />
      <div className="mobile-chart-fallback">
        <strong>移动端摘要</strong>
        <p>样本 {faultOnsetSample} 前为正常基线；当前已回放到 {currentSample}，重点关注 {evidenceVariables.map((item) => item.id).join("、")}。</p>
      </div>
      <details className="data-table-disclosure">
        <summary>查看异常变量摘要表</summary>
        <table aria-label="热力图异常变量摘要">
          <thead><tr><th scope="col">变量</th><th scope="col">样本窗口</th><th scope="col">状态</th></tr></thead>
          <tbody>{evidenceVariables.map((item) => <tr key={item.id}><th scope="row">{item.id} {item.name}</th><td>{faultOnsetSample}-{Math.min(totalSamples, faultOnsetSample + 50)}</td><td>显著偏移</td></tr>)}</tbody>
        </table>
      </details>
    </section>
  );
}

export function EvidenceTrendChart({ evidence }: { evidence: EvidenceItem[] }) {
  return (
    <section className="chart-panel evidence-chart-panel" aria-labelledby="trend-title">
      <div className="section-heading"><div><span className="kicker">共享时间轴</span><h2 id="trend-title">三项证据对齐趋势</h2></div><span className="event-window-label">样本 160 起偏移</span></div>
      <p role="status" className="sr-summary">三条趋势均从样本 160 后偏离基线。冷却水出口温度贡献最高，阀开度随后上升，反应器温度同步缓慢上行。</p>
      <ReactECharts option={createEvidenceTrendOption(evidence)} className="evidence-chart" opts={{ renderer: "canvas" }} aria-hidden="true" />
    </section>
  );
}

export function EnvironmentalTrendChart({
  dayIndex,
  totalPhosphorus,
  membraneAnomalyScore,
  regulatoryLimit,
  warningDay,
  breachDay,
}: {
  dayIndex: number[];
  totalPhosphorus: number[];
  membraneAnomalyScore: number[];
  regulatoryLimit: number;
  warningDay: number | null;
  breachDay: number | null;
}) {
  const categories = dayIndex.map((day) => `第${day}天`);
  return (
    <section className="chart-panel" aria-labelledby="environmental-trend-title">
      <div className="section-heading">
        <div><span className="kicker">先导指标 vs 泉点总磷（示意数据）</span><h2 id="environmental-trend-title">交椅山渣库渗滤液早期预警</h2></div>
      </div>
      <p role="status" className="sr-summary">
        防渗膜异常置信度{warningDay !== null ? `在第 ${warningDay} 天` : ""}率先偏离基线，
        总磷浓度{breachDay !== null ? `在第 ${breachDay} 天` : "在较晚时点"}于泉点突破 {regulatoryLimit} mg/L 特别排放限值。
      </p>
      <ReactECharts
        className="evidence-chart"
        opts={{ renderer: "canvas" }}
        aria-hidden="true"
        option={{
          animation: false,
          grid: { left: 56, right: 56, top: 32, bottom: 40 },
          tooltip: { trigger: "axis" },
          legend: { top: 0, textStyle: { fontSize: 11 } },
          xAxis: { type: "category", data: categories, axisLabel: { interval: 29 } },
          yAxis: [
            { type: "value", name: "总磷 mg/L", position: "left" },
            { type: "value", name: "膜异常置信度", position: "right", min: 0, max: 1 },
          ],
          series: [
            {
              name: "总磷浓度（桂花泉）",
              type: "line",
              data: totalPhosphorus,
              showSymbol: false,
              lineStyle: { color: "#c2410c" },
              markLine: {
                symbol: "none",
                data: [
                  { yAxis: regulatoryLimit, label: { formatter: `特别排放限值 ${regulatoryLimit}mg/L` } },
                  ...(breachDay !== null ? [{ xAxis: breachDay, label: { formatter: "泉点超标" } }] : []),
                ],
              },
            },
            {
              name: "防渗膜异常置信度",
              type: "line",
              yAxisIndex: 1,
              data: membraneAnomalyScore,
              showSymbol: false,
              lineStyle: { color: "#13c2c2" },
              markLine: warningDay !== null
                ? { symbol: "none", data: [{ xAxis: warningDay, label: { formatter: "先导预警" } }] }
                : undefined,
            },
          ],
        }}
      />
    </section>
  );
}

export function ContributionChart({ evidence }: { evidence: EvidenceItem[] }) {
  const sorted = [...evidence].sort((a, b) => a.contribution - b.contribution);
  const maxContribution = Math.max(1, ...sorted.map((item) => item.contribution));
  return (
    <section className="compact-chart" aria-labelledby="contribution-title">
      <h3 id="contribution-title">SPE 变量贡献</h3>
      <p className="sr-summary">SPE 贡献值由高到低为 {evidence.map((item) => `${item.variableId} ${formatContribution(item.contribution)}`).join("、")}。</p>
      <ReactECharts
        className="contribution-chart"
        aria-hidden="true"
        option={{
          animation: false,
          grid: { left: 72, right: 30, top: 8, bottom: 8 },
          xAxis: { type: "value", max: maxContribution * 1.28, show: false },
          yAxis: { type: "category", data: sorted.map((item) => item.variableId), axisTick: { show: false }, axisLine: { show: false } },
          series: [{ type: "bar", data: sorted.map((item) => ({ value: item.contribution, itemStyle: { color: "#24839b", borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", formatter: formatContribution(item.contribution) } })), barWidth: 10 }],
        }}
      />
    </section>
  );
}
