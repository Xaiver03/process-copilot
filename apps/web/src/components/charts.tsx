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
}: {
  currentSample?: number;
  faultOnsetSample?: number;
} = {}) {
  return (
    <section className="chart-panel heatmap-panel" aria-labelledby="heatmap-title">
      <div className="section-heading">
        <div><span className="kicker">52 路变量总览</span><h2 id="heatmap-title">过程偏移热力图</h2></div>
        <span className="legend-copy"><i className="legend-normal" />正常 <i className="legend-drift" />偏移 <i className="legend-alarm" />严重</span>
      </div>
      <p className="sr-summary" role="status">样本 {faultOnsetSample} 前为正常基线，之后 XMEAS(9)、XMEAS(21) 与 XMV(10) 的偏移强度明显上升；当前已回放到样本 {currentSample}。</p>
      <ReactECharts
        option={createProcessHeatmapOption(currentSample, faultOnsetSample)}
        className="heatmap-chart desktop-chart"
        opts={{ renderer: "canvas" }}
        aria-hidden="true"
      />
      <div className="mobile-chart-fallback">
        <strong>移动端摘要</strong>
        <p>样本 {faultOnsetSample} 前为正常基线；当前已回放到 {currentSample}，重点关注 XMEAS(9)、XMEAS(21) 与 XMV(10)。</p>
      </div>
      <details className="data-table-disclosure">
        <summary>查看异常变量摘要表</summary>
        <table aria-label="热力图异常变量摘要">
          <thead><tr><th scope="col">变量</th><th scope="col">样本窗口</th><th scope="col">状态</th></tr></thead>
          <tbody>
            <tr><th scope="row">XMEAS(9) 反应器温度</th><td>160-210</td><td>严重偏移</td></tr>
            <tr><th scope="row">XMEAS(21) 冷却水出口温度</th><td>160-210</td><td>严重偏移</td></tr>
            <tr><th scope="row">XMV(10) 冷却水流量阀</th><td>168-210</td><td>过程偏移</td></tr>
          </tbody>
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
