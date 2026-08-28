"use client";

import {
  ArrowRight,
  CheckCircle,
  Clock,
  Pause,
  Play,
  ShieldWarning,
  Warning,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { components } from "@/lib/api-schema";
import {
  controlRunWithFallback,
  getEventWithFallback,
  getReadinessWithFallback,
  getRecordWithFallback,
  getScenariosWithFallback,
  listRunEventsWithFallback,
  startScenarioWithFallback,
  submitDecisionWithFallback,
  type ApiResult,
} from "@/lib/api-client";
import { demoEvent, demoRun } from "@/lib/demo-data";
import { useSession } from "@/lib/auth-store";
import { eventSeverityPresentation, eventStateLabel, formatFaultCandidate } from "@/lib/presentation";
import { ContributionChart, EvidenceTrendChart, ProcessHeatmapChart } from "./charts";
import { DemoJourney } from "./demo-journey";
import { EvidencePanel, HumanDecision, StatusTag } from "./industrial";
import { ModeNotice } from "./mode-notice";
import { StatePanel } from "./state-panel";

type Scenario = components["schemas"]["Scenario"];
type ReplayRun = components["schemas"]["ReplayRun"];
type AnomalyEvent = components["schemas"]["AnomalyEvent"];
type EventDetail = components["schemas"]["EventDetail"];
type DecisionRecord = components["schemas"]["DecisionRecord"];
type Health = components["schemas"]["Health"];

function useApiResource<T>(loader: () => Promise<ApiResult<T>>, key: string) {
  const loaderRef = useRef(loader);
  const [result, setResult] = useState<ApiResult<T> | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  loaderRef.current = loader;
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    loaderRef.current().then((value) => active && setResult(value)).catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : "数据读取失败"));
    return () => { active = false; };
  }, [key, revision]);
  return { result, error, retry: () => setRevision((value) => value + 1) };
}

function PageHeader({ kicker, title, summary }: { kicker: string; title: string; summary: string }) {
  return (
    <header className="page-header">
      <span className="kicker">{kicker}</span>
      <h1>{title}</h1>
      <p>{summary}</p>
    </header>
  );
}

function ResourceBoundary<T>({
  result,
  error,
  retry,
  children,
}: {
  result: ApiResult<T> | null;
  error: string;
  retry: () => void;
  children: (value: ApiResult<T>) => React.ReactNode;
}) {
  if (error) return <StatePanel state="error" detail={error} onRetry={retry} />;
  if (!result) return <StatePanel state="loading" />;
  return <>{children(result)}</>;
}

export function DemoScreen() {
  return (
    <div className="page-stack demo-page">
      <StatePanel state="read-only" compact />
      <DemoJourney />
      <Link className="text-link" href="/replay">进入完整过程回放 <ArrowRight aria-hidden="true" /></Link>
    </div>
  );
}

export function OverviewScreen() {
  const resource = useApiResource<Scenario[]>(getScenariosWithFallback, "scenarios");
  return (
    <div className="page-stack">
      <PageHeader kicker="运营总览" title="装置过程状态" summary="先看偏移与数据新鲜度，再进入单个事件完成研判。" />
      <ResourceBoundary {...resource}>{(result) => (
        <>
          <ModeNotice mode={result.mode} notice={result.notice} />
          <section className="metric-strip" aria-label="关键运行指标">
            <div><span>过程状态</span><strong className="metric-alert">严重偏移</strong><small>样本 176</small></div>
            <div><span>异常分数</span><strong>0.87</strong><small>阈值 0.62</small></div>
            <div><span>待研判事件</span><strong>1</strong><small>总事件 3</small></div>
            <div><span>公开场景</span><strong>{result.data.length}</strong><small>TEP 仿真</small></div>
          </section>
          <div className="overview-grid">
            <ProcessHeatmapChart />
            <aside className="event-rail">
              <div className="section-heading"><div><span className="kicker">当前优先</span><h2>待研判事件</h2></div></div>
              <StatusTag state="critical" label="严重偏移" />
              <strong>冷却水回路响应异常</strong>
              <p>Top-1 候选：反应器冷却水入口温度阶跃，置信度 74%。</p>
              <Link className="primary-button link-button" href={result.mode === "static-demo" ? "/events/demo-event" : "/demo"}>{result.mode === "static-demo" ? "进入静态研判" : "启动真实主链路"} <ArrowRight aria-hidden="true" /></Link>
            </aside>
          </div>
        </>
      )}</ResourceBoundary>
    </div>
  );
}

export function ReplayScreen() {
  const scenarios = useApiResource<Scenario[]>(getScenariosWithFallback, "replay-scenarios");
  const [selectedId, setSelectedId] = useState("");
  const [journey, setJourney] = useState<ApiResult<{ run: ReplayRun; event: AnomalyEvent }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!selectedId && scenarios.result?.data[0]) setSelectedId(scenarios.result.data[0].id);
  }, [scenarios.result, selectedId]);

  async function startReplay() {
    if (!selectedId) return;
    setBusy(true);
    setActionError("");
    try {
      setJourney(await startScenarioWithFallback(selectedId, 10));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "回放创建失败");
    } finally {
      setBusy(false);
    }
  }
  async function pauseReplay() {
    if (!journey) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await controlRunWithFallback(journey.data.run.id, { action: "pause" });
      setJourney({ ...journey, data: { ...journey.data, run: result.data }, mode: result.mode, notice: result.notice });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "暂停失败");
    } finally {
      setBusy(false);
    }
  }
  async function changeSpeed(speed: 1 | 5 | 10 | 20) {
    if (!journey) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await controlRunWithFallback(journey.data.run.id, {
        action: journey.data.run.state === "paused" ? "pause" : "play",
        speed,
      });
      setJourney({ ...journey, data: { ...journey.data, run: result.data }, mode: result.mode, notice: result.notice });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "倍速调整失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-stack replay-page">
      <PageHeader kicker="过程回放" title="52 路过程数据回放" summary="热力图先定位变量组，再用事件研判页查看三条对齐证据。" />
      {journey ? <ModeNotice mode={journey.mode} notice={journey.notice} /> : scenarios.result ? <ModeNotice mode={scenarios.result.mode} notice={scenarios.result.notice} /> : <StatePanel state="read-only" compact />}
      {scenarios.error ? <div className="form-error" role="alert"><p>{scenarios.error}</p><button className="text-link" type="button" onClick={scenarios.retry}>重试读取场景</button></div> : null}
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      <section className="replay-control" aria-label="回放控制">
        <label>场景<select aria-label="回放场景" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={busy || !scenarios.result}>{scenarios.result?.data.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
        <button className="control-button" type="button" onClick={startReplay} disabled={busy || !selectedId} aria-label="开始回放">
          {busy ? <Clock aria-hidden="true" /> : <Play aria-hidden="true" weight="fill" />}<span>{busy ? "创建回放中" : "开始回放"}</span>
        </button>
        <button className="control-button" type="button" disabled={!journey || busy} aria-label="暂停回放" onClick={pauseReplay}><Pause aria-hidden="true" weight="fill" /><span>暂停</span></button>
        <label>倍速<select aria-label="回放倍速" value={String(journey?.data.run.speed ?? 10)} disabled={!journey || busy} onChange={(event) => void changeSpeed(Number(event.target.value) as 1 | 5 | 10 | 20)}><option value="1">1×</option><option value="5">5×</option><option value="10">10×</option><option value="20">20×</option></select></label>
        <div className="sample-readout"><span>{journey?.data.run.state === "playing" ? "回放进行中" : journey?.data.run.state === "paused" ? "回放已暂停" : "当前样本"}</span><strong>{journey?.data.run.currentSample ?? 0}</strong><small>/ 500</small></div>
      </section>
      <ProcessHeatmapChart />
      {journey ? <section className="capture-banner">
        <div><Warning weight="fill" aria-hidden="true" /><p><strong>样本 {journey.data.event.sampleIndex} 捕获{journey.data.event.severity === "critical" ? "严重" : ""}偏移</strong><span>异常分数 {journey.data.event.anomalyScore.toFixed(2)}，事件 ID 来自当前 run。</span></p></div>
        <div><Link className="primary-button link-button" href={journey.mode === "static-demo" ? "/events/demo-event" : `/events/${journey.data.event.id}`}>进入事件研判 <ArrowRight aria-hidden="true" /></Link>{journey.mode === "live" ? <Link className="text-link" href={`/events?runId=${journey.data.run.id}`}>查看本次事件队列</Link> : null}</div>
      </section> : null}
    </div>
  );
}

function RunEventList({ runId }: { runId: string }) {
  const resource = useApiResource<AnomalyEvent[]>(() => listRunEventsWithFallback(runId), runId);
  return (
    <ResourceBoundary {...resource}>{(result) => (
      <>
        <ModeNotice mode={result.mode} notice={result.notice} />
        {result.data.length === 0 ? <StatePanel state="empty" /> : (
          <section className="table-panel">
            <table aria-label="偏移事件列表">
              <thead><tr><th scope="col">事件</th><th scope="col">样本</th><th scope="col" aria-sort="descending">严重度</th><th scope="col">异常分数</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
              <tbody>{result.data.map((event, index) => (
                <tr key={event.id}>
                  <th scope="row">EVT-{String(index + 1).padStart(3, "0")}</th><td>{event.sampleIndex}</td><td><StatusTag {...eventSeverityPresentation[event.severity]} /></td><td>{event.anomalyScore.toFixed(2)}</td><td>{eventStateLabel[event.state]}</td><td><Link className="table-link" href={result.mode === "static-demo" && index === 0 ? "/events/demo-event" : `/events/${event.id}`}>打开研判</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}
      </>
    )}</ResourceBoundary>
  );
}

export function EventsScreen({ runId }: { runId?: string }) {
  return (
    <div className="page-stack">
      <PageHeader kicker="偏移事件" title="事件队列" summary="按严重度和发生时间筛选，所有事件都可通过 URL 深链接打开。" />
      {runId ? <RunEventList runId={runId} /> : <section className="state-panel state-empty" role="status"><div><strong>请先选择一次回放</strong><p>事件队列按真实 run ID 读取，不使用固定演示 ID 替代现场数据。</p><Link className="text-link" href="/replay">进入过程回放</Link></div></section>}
    </div>
  );
}

export function EventDetailScreen({ eventId }: { eventId: string }) {
  const resource = useApiResource<EventDetail>(() => getEventWithFallback(eventId), eventId);
  const [recordHref, setRecordHref] = useState("");
  const [decisionMode, setDecisionMode] = useState<"live" | "static-demo" | null>(null);
  const session = useSession();
  return (
    <div className="page-stack event-detail-page">
      <ResourceBoundary {...resource}>{(result) => {
        const event = result.data;
        const topCandidate = event.candidates[0] ? formatFaultCandidate(event.candidates[0]) : null;
        const severity = eventSeverityPresentation[event.severity];
        return (
          <>
            <PageHeader kicker="事件研判" title={topCandidate?.label ?? `偏移事件 ${event.id}`} summary={`当前状态：${eventStateLabel[event.state]}。用故障候选、三项变量证据和安全规则建议支持当班工程师判断。`} />
            <ModeNotice mode={result.mode} notice={result.notice} />
            <section className="risk-banner"><ShieldWarning weight="fill" aria-hidden="true" /><div><span>风险提示</span><strong>{event.recommendation.risk}</strong><p>{event.recommendation.safetyBoundary}</p></div><StatusTag state={severity.state} label={`${severity.label}·${eventStateLabel[event.state]}`} /></section>
            <section className="diagnosis-timeline" aria-labelledby="diagnosis-timeline-title">
              <div>
                <span className="kicker">两阶段研判</span>
                <h2 id="diagnosis-timeline-title">先发现偏移，再刷新候选</h2>
                <p>事件在样本 {event.detectionSample} 被锁定；候选和证据在固定延迟 {event.diagnosisDelaySamples} 个样本后于样本 {event.diagnosisSample} 刷新。“已更新”不等于故障已确认。</p>
              </div>
              <dl>
                <div><dt>首次异常分数</dt><dd>{event.anomalyScore.toFixed(2)}</dd></div>
                <div><dt>刷新时异常分数</dt><dd>{event.diagnosisAnomalyScore.toFixed(2)}</dd></div>
                <div><dt>初始 Top-1</dt><dd>{event.initialCandidates[0] ? formatFaultCandidate(event.initialCandidates[0]).label : "暂无候选"}</dd></div>
                <div><dt>研判状态</dt><dd>{event.diagnosisState === "updated" ? "候选已更新" : event.diagnosisState === "provisional" ? "临时候选" : "等待更新"}</dd></div>
              </dl>
            </section>
            <div className="investigation-grid">
              <div className="investigation-main">
                <EvidenceTrendChart evidence={event.evidence} />
                <EvidencePanel evidence={event.evidence} />
              </div>
              <aside className="investigation-rail">
                <section className="side-panel"><span className="kicker">Top-3</span><h2>故障候选</h2><ol className="candidate-list">{event.candidates.map((candidate, index) => { const display = formatFaultCandidate(candidate); return <li key={`${candidate.faultId}-${index}`}><span><b>{display.code}</b>{display.label}</span><strong>{display.probability}</strong></li>; })}</ol></section>
                <ContributionChart evidence={event.evidence} />
                <section className="side-panel"><span className="kicker">安全规则建议</span><h2>检查与动作</h2><h3>优先检查</h3><ul>{event.recommendation.checks.map((item) => <li key={item}>{item}</li>)}</ul><h3>建议动作</h3><ul>{event.recommendation.actions.map((item) => <li key={item}>{item}</li>)}</ul></section>
                {recordHref ? <section className="decision-success" role="status"><CheckCircle weight="fill" aria-hidden="true" /><div><strong>事件记录已形成</strong><span>{decisionMode === "static-demo" ? "静态 Demo 记录未写入服务器。" : "记录已写入审计服务。"}</span><Link href={recordHref}>打开审计记录</Link></div></section> : session ? (
                  <HumanDecision
                    operatorName={`${session.displayName}（${session.username}）`}
                    operatorRole={session.role}
                    onSubmit={async (payload) => { const decision = await submitDecisionWithFallback(eventId, payload); setDecisionMode(decision.mode); setRecordHref(`/records/${decision.mode === "static-demo" ? "demo-record" : decision.data.id}`); }}
                  />
                ) : (
                  <section className="side-panel login-prompt" role="status">
                    <span className="kicker">人工确认点</span>
                    <h2>研判需要登录</h2>
                    <p>人工决策必须绑定预置操作员身份，记录写入审计服务后不可篡改。</p>
                    <Link className="primary-button link-button" href={`/login?next=/events/${eventId}`}>登录操作员账号</Link>
                  </section>
                )}
              </aside>
            </div>
          </>
        );
      }}</ResourceBoundary>
    </div>
  );
}

export function RecordScreen({ recordId }: { recordId: string }) {
  const resource = useApiResource<DecisionRecord>(() => getRecordWithFallback(recordId), recordId);
  return (
    <div className="page-stack">
      <PageHeader kicker="审计留痕" title="事件决策记录" summary="查看证据、模型版本、操作者和不可变追踪信息。" />
      <ResourceBoundary {...resource}>{(result) => (
        <>
          <ModeNotice mode={result.mode} notice={result.notice} />
          <section className="record-summary"><StatusTag state="normal" label="已形成记录" /><dl><div><dt>记录 ID</dt><dd>{result.data.id}</dd></div><div><dt>事件 ID</dt><dd>{result.data.eventId}</dd></div><div><dt>操作者</dt><dd>{result.data.operatorName}</dd></div><div><dt>结论</dt><dd>{result.data.decision === "confirm" ? "确认偏移" : result.data.decision === "reject" ? "驳回偏移" : "升级处理"}</dd></div><div><dt>模型版本</dt><dd>{result.data.modelVersion}</dd></div><div><dt>Trace ID</dt><dd>{result.data.traceId}</dd></div></dl></section>
          {result.mode === "static-demo" ? <section className="audit-timeline" aria-labelledby="audit-title"><h2 id="audit-title">静态演示叙事时间线</h2><p>以下时间与样本仅用于 Demo 叙事，非现场审计数据。</p><ol><li><span>08:31</span><div><strong>偏移发现</strong><p>演示样本 160，事件在异常分数 1.12 时锁定。</p></div></li><li><span>09:31</span><div><strong>候选更新</strong><p>固定延迟 20 个样本后刷新证据，不代表人工确认。</p></div></li><li><span>09:36</span><div><strong>人工确认</strong><p>{result.data.operatorName}：{result.data.note}</p></div></li></ol></section> : <section className="audit-timeline" aria-labelledby="audit-title"><h2 id="audit-title">审计时间线</h2><ol><li><span>{new Date(result.data.createdAt).toLocaleString("zh-CN", { hour12: false })}</span><div><strong>决策记录已创建</strong><p>{result.data.operatorName}：{result.data.note}</p></div></li></ol></section>}
        </>
      )}</ResourceBoundary>
    </div>
  );
}

export function SystemScreen() {
  const resource = useApiResource<Health>(getReadinessWithFallback, "readyz");
  return (
    <div className="page-stack">
      <PageHeader kicker="系统状态" title="数据与模型健康" summary="核对 API、Demo 数据、模型版本和只读边界，不提供控制写入入口。" />
      <ResourceBoundary {...resource}>{(result) => (
        <>
          <ModeNotice mode={result.mode} notice={result.notice} />
          <section className="system-grid">
            <div><span>应用状态</span><StatusTag state={result.data.status === "ok" ? "normal" : "warning"} label={result.data.status === "ok" ? "就绪" : "降级"} /><p>静态 Demo 可继续完成主链路。</p></div>
            <div><span>数据来源</span><strong>Tennessee Eastman Process</strong><p>公开仿真数据，不是真实贵州工厂数据。</p></div>
            <div><span>模型版本</span><strong>{demoEvent.modelVersion}</strong><p>双阶段偏移检测与故障候选 Demo。</p></div>
            <div><span>安全边界</span><strong>Read-only</strong><p>无 DCS、PLC 写回能力。</p></div>
          </section>
          <section className="table-panel"><table aria-label="系统依赖检查"><thead><tr><th scope="col">依赖</th><th scope="col">状态</th><th scope="col">说明</th></tr></thead><tbody>{Object.entries(result.data.checks ?? { api: result.data.status }).map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td><td>{name === "api" && result.mode === "static-demo" ? "API 失联，已启用静态 Demo" : "检查结果来自 readiness"}</td></tr>)}</tbody></table></section>
        </>
      )}</ResourceBoundary>
    </div>
  );
}

export const demoRunId = demoRun.id;
