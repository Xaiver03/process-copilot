"use client";

import {
  ArrowRight,
  Brain,
  ChartLineUp,
  CheckCircle,
  Clock,
  ListChecks,
  Pause,
  Play,
  Pulse,
  UserFocus,
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
  startOnlineScenarioWithFallback,
  submitDecisionWithFallback,
  type ApiResult,
} from "@/lib/api-client";
import { demoEvent, demoRun } from "@/lib/demo-data";
import { useSession } from "@/lib/auth-store";
import { eventSeverityPresentation, eventStateLabel, formatFaultCandidate, formatScenarioPresentation, localizeIndustrialCopy } from "@/lib/presentation";
import { advanceReplaySample, createReplayTelemetry, describeReplayStage, getReplaySignalDefinitions, normalizeReplaySpeed, REPLAY_TICK_MS, REPLAY_TOTAL_SAMPLES } from "@/lib/replay-demo";
import { subscribeToRun, type RunStreamMessage } from "@/lib/run-stream";
import { ContributionChart, EvidenceTrendChart, ProcessHeatmapChart } from "./charts";
import { DemoJourney } from "./demo-journey";
import { EvidencePanel, HumanDecision, StatusTag } from "./industrial";
import { EventCopilot } from "./event-copilot";
import { ModeNotice } from "./mode-notice";
import { StatePanel } from "./state-panel";

type Scenario = components["schemas"]["Scenario"];
type ReplayRun = components["schemas"]["ReplayRun"];
type AnomalyEvent = components["schemas"]["AnomalyEvent"];
type EventDetail = components["schemas"]["EventDetail"];
type DecisionRecord = components["schemas"]["DecisionRecord"];
type Health = components["schemas"]["Health"];
const EVENT_DETAIL_AI_STEPS = ["step-01-detection", "step-02-conclusion", "step-03-explanation", "step-04-recommendation", "step-05-decision"] as const;
type EventDetailAiStepId = (typeof EVENT_DETAIL_AI_STEPS)[number];

function isEventDetailAiStepId(value: string): value is EventDetailAiStepId {
  return (EVENT_DETAIL_AI_STEPS as readonly string[]).includes(value);
}

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
  const overviewCandidate = formatFaultCandidate(demoEvent.candidates[0]);
  return (
    <div className="page-stack">
      <PageHeader kicker="AI 运营总览" title="装置过程状态" summary="先看 AI 发现的偏移、当前故障假设和待确认事件，再进入证据页完成人工研判。" />
      <ResourceBoundary {...resource}>{(result) => (
        <>
          <ModeNotice mode={result.mode} notice={result.notice} />
          <section className="metric-strip" aria-label="关键运行指标">
            <div><span>装置状态</span><strong className="metric-alert">严重偏移</strong><small>AI 锁定样本 {demoEvent.detectionSample}</small></div>
            <div><span>AI 异常分数</span><strong>{demoEvent.anomalyScore.toFixed(2)}</strong><small>持续性条件已满足</small></div>
            <div><span>AI 当前假设</span><strong className="metric-hypothesis">冷却水入口温度</strong><small>Top-1 · {overviewCandidate.probability}</small></div>
            <div><span>待人工确认</span><strong>1</strong><small>AI 已完成证据整理</small></div>
          </section>
          <div className="overview-grid">
            <ProcessHeatmapChart />
              <aside className="event-rail">
              <div className="section-heading"><div><span className="kicker">AI 当前判断</span><h2>优先原因</h2></div></div>
              <p className="event-ai-summary">三项关键变量在同一时间窗内共同偏离，AI 将<strong>{overviewCandidate.label}</strong>排为当前首要故障假设。</p>
              <dl className="priority-reasons">
                <div><dt>发现</dt><dd>样本 {demoEvent.detectionSample} 锁定偏移</dd></div>
                <div><dt>判断</dt><dd>Top-1 概率 {overviewCandidate.probability}</dd></div>
                <div><dt>解释</dt><dd>{demoEvent.evidence[0].variableId} 贡献最高</dd></div>
                <div><dt>下一步</dt><dd>等待当班人员确认</dd></div>
              </dl>
              <Link className="primary-button link-button" href={result.mode === "static-demo" ? "/events/demo-event" : "/demo"}>查看 AI 研判依据 <ArrowRight aria-hidden="true" /></Link>
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
  const [journey, setJourney] = useState<ApiResult<{ run: ReplayRun; event?: AnomalyEvent }> | null>(null);
  const [displaySample, setDisplaySample] = useState(0);
  const [replayCompleted, setReplayCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const selectedScenario = scenarios.result?.data.find((scenario) => scenario.id === selectedId);
  const totalSamples = selectedScenario?.sampleCount ?? REPLAY_TOTAL_SAMPLES;
  const liveRunId = journey?.mode === "live" ? journey.data.run.id : undefined;

  useEffect(() => {
    if (!selectedId && scenarios.result?.data[0]) setSelectedId(scenarios.result.data[0].id);
  }, [scenarios.result, selectedId]);

  useEffect(() => {
    if (!journey || journey.mode !== "static-demo" || journey.data.run.state !== "playing" || replayCompleted) return;
    const timer = window.setInterval(() => {
      setDisplaySample((sample) => {
        const next = advanceReplaySample(sample, normalizeReplaySpeed(journey.data.run.speed), totalSamples);
        if (next >= totalSamples) {
          window.clearInterval(timer);
          setReplayCompleted(true);
        }
        return next;
      });
    }, REPLAY_TICK_MS);
    return () => window.clearInterval(timer);
  }, [journey, replayCompleted, totalSamples]);

  useEffect(() => {
    if (!liveRunId) return;
    const runId = liveRunId;
    let active = true;

    const updateRun = (message: RunStreamMessage, completed = false) => {
      setActionError("");
      setJourney((current) => {
        if (!active || !current || current.data.run.id !== runId) return current;
        const sampleIndex = message.inference?.sampleIndex ?? message.sampleIndex;
        return {
          ...current,
          data: {
            ...current.data,
            run: {
              ...current.data.run,
              ...(message.state ? { state: message.state } : {}),
              ...(sampleIndex !== undefined ? { currentSample: sampleIndex } : {}),
            },
          },
        };
      });
      const sampleIndex = message.inference?.sampleIndex ?? message.sampleIndex;
      if (sampleIndex !== undefined) setDisplaySample(sampleIndex);
      if (completed) setReplayCompleted(true);
    };

    const refreshLiveEvent = async () => {
      try {
        const result = await listRunEventsWithFallback(runId);
        if (result.mode === "static-demo") {
          throw new Error(`回放 ${runId} 已在服务器运行，但事件读取失败；不会混用静态事件。`);
        }
        const event = result.data.find((candidate) => candidate.state === "open") ?? result.data[0];
        if (!active) return;
        setActionError("");
        setJourney((current) => current && current.data.run.id === runId
          ? { ...current, data: { ...current.data, event } }
          : current);
      } catch (cause) {
        if (active) setActionError(cause instanceof Error ? cause.message : "在线事件读取失败");
      }
    };

    const unsubscribe = subscribeToRun(runId, {
      onState: (message) => updateRun(message, message.state === "completed" || message.state === "failed"),
      onInference: (message) => updateRun(message),
      onAnomalyOpened: () => { void refreshLiveEvent(); },
      onDiagnosisUpdated: () => { void refreshLiveEvent(); },
      onCompleted: (message) => updateRun(message, true),
      onFailed: (message) => {
        updateRun(message, true);
        setActionError(message.message ?? "在线回放执行失败");
      },
      onError: (error) => setActionError(error.message),
      onHeartbeat: () => setActionError(""),
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [liveRunId]);

  async function startReplay() {
    if (!selectedId) return;
    setBusy(true);
    setActionError("");
    try {
      if (journey?.data.run.state === "paused") {
        const result = await controlRunWithFallback(journey.data.run.id, { action: "play", speed: normalizeReplaySpeed(journey.data.run.speed) });
        setJourney({ ...journey, data: { ...journey.data, run: result.data }, mode: result.mode, notice: result.notice });
      } else {
        const result = await startOnlineScenarioWithFallback(selectedId, 10);
        setJourney(result);
        setDisplaySample(result.data.run.currentSample);
        setReplayCompleted(result.data.run.state === "completed" || result.data.run.state === "failed" || result.data.run.currentSample >= totalSamples);
      }
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
  const faultOnsetSample = selectedScenario?.faultOnsetSample ?? 160;
  const replayStage = describeReplayStage(displaySample, faultOnsetSample, journey?.data.event?.sampleIndex ?? faultOnsetSample);
  const replaySignals = getReplaySignalDefinitions(selectedScenario?.faultId ?? 4);
  const isStaticReplay = journey?.mode === "static-demo" || journey?.data.run.inferenceMode === "template";
  const telemetry = isStaticReplay ? createReplayTelemetry(displaySample, faultOnsetSample, selectedScenario?.faultId ?? 4) : [];
  const eventVisible = Boolean(journey?.data.event && displaySample >= journey.data.event.sampleIndex);
  return (
    <div className="page-stack replay-page">
      <PageHeader kicker="过程回放" title="52 路过程数据回放" summary="热力图先定位变量组，再用事件研判页查看三条对齐证据。" />
      {journey ? <ModeNotice mode={journey.mode} notice={journey.notice} /> : scenarios.result ? <ModeNotice mode={scenarios.result.mode} notice={scenarios.result.notice} /> : <StatePanel state="read-only" compact />}
      {scenarios.error ? <div className="form-error" role="alert"><p>{scenarios.error}</p><button className="text-link" type="button" onClick={scenarios.retry}>重试读取场景</button></div> : null}
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      <section className="replay-control" aria-label="回放控制">
        <label className="replay-field replay-scenario-field">场景<select aria-label="回放场景" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setJourney(null); setDisplaySample(0); setReplayCompleted(false); }} disabled={busy || !scenarios.result}>{scenarios.result?.data.map((scenario) => <option key={scenario.id} value={scenario.id}>{formatScenarioPresentation(scenario).name}</option>)}</select></label>
        <button className="control-button" type="button" onClick={startReplay} disabled={busy || !selectedId} aria-label="开始回放">
          {busy ? <Clock aria-hidden="true" /> : <Play aria-hidden="true" weight="fill" />}<span>{busy ? "创建回放中" : "开始回放"}</span>
        </button>
        <button className="control-button" type="button" disabled={!journey || busy || replayCompleted} aria-label="暂停回放" onClick={pauseReplay}><Pause aria-hidden="true" weight="fill" /><span>暂停</span></button>
        <label className="replay-field replay-speed-field">倍速<select aria-label="回放倍速" value={String(journey?.data.run.speed ?? 10)} disabled={!journey || busy || replayCompleted} onChange={(event) => void changeSpeed(Number(event.target.value) as 1 | 5 | 10 | 20)}><option value="1">1×</option><option value="5">5×</option><option value="10">10×</option><option value="20">20×</option></select></label>
        <div className="sample-readout"><span>{replayCompleted ? "回放已完成" : journey?.data.run.state === "playing" ? "回放进行中" : journey?.data.run.state === "paused" ? "回放已暂停" : "当前样本"}</span><strong data-testid="current-sample">{displaySample}</strong><small>/ {totalSamples}</small></div>
      </section>
      {journey ? <section className={`replay-stage replay-stage-${replayStage.state}`}>
        <div role="status" aria-live="polite"><span className="replay-live-dot" aria-hidden="true" /><p><strong>{replayCompleted ? "回放完成" : replayStage.title}</strong><span>{replayCompleted ? `已读取 ${totalSamples} 个样本，可进入事件研判。` : replayStage.detail}</span></p></div>
        <div className="replay-progress"><span style={{ width: `${Math.min(100, displaySample / totalSamples * 100)}%` }} /></div>
        {telemetry.length > 0 ? <dl className="replay-telemetry">{telemetry.map((item) => <div key={item.id}><dt>{item.id}<span>{item.name}</span></dt><dd>{item.value.toFixed(2)} <small>{item.unit}</small></dd></div>)}</dl> : <p className="simulation-disclosure">在线 AI 推理样本通过实时事件流更新，不展示替代遥测。</p>}
        {isStaticReplay ? <p className="simulation-disclosure">场景仿真变量 · 非现场实时遥测</p> : null}
      </section> : null}
      <ProcessHeatmapChart currentSample={journey ? displaySample : Math.max(0, faultOnsetSample - 10)} faultOnsetSample={faultOnsetSample} totalSamples={totalSamples} evidenceVariables={replaySignals.map(({ id, name }) => ({ id, name }))} />
      {journey && eventVisible && journey.data.event ? <section className="capture-banner">
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
  const [activeAiStep, setActiveAiStep] = useState<EventDetailAiStepId>(EVENT_DETAIL_AI_STEPS[0]);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (isEventDetailAiStepId(hash)) {
      setActiveAiStep(hash);
    } else {
      setActiveAiStep(EVENT_DETAIL_AI_STEPS[0]);
    }

    const onHashChange = () => {
      const next = window.location.hash.replace("#", "");
      setActiveAiStep(isEventDetailAiStepId(next) ? next : EVENT_DETAIL_AI_STEPS[0]);
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [eventId]);

  function goToStep(targetId: EventDetailAiStepId) {
    const section = document.getElementById(targetId);
    if (!section) return;
    const prefersReduceMotion = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    section.scrollIntoView({ behavior: prefersReduceMotion ? "auto" : "smooth", block: "start" });
    section.focus({ preventScroll: true });
    setActiveAiStep(targetId);
    if (window.location.hash !== `#${targetId}`) {
      history.replaceState(null, "", `#${targetId}`);
    }
  }

  return (
    <div className="page-stack event-detail-page">
      <ResourceBoundary {...resource}>{(result) => {
        const event = result.data;
        const topCandidate = event.candidates[0] ? formatFaultCandidate(event.candidates[0]) : null;
        const severity = eventSeverityPresentation[event.severity];
        return (
          <>
            <PageHeader kicker="AI 事件研判" title={topCandidate?.label ?? `偏移事件 ${event.id}`} summary={`AI 已完成偏移发现、故障候选排序和变量证据对齐，当前等待${eventStateLabel[event.state] === "待研判" ? "人工确认" : "查看人工结论"}。`} />
            <ModeNotice mode={result.mode} notice={result.notice} />
            <ol className="ai-stepper" aria-label="AI 研判主链路">
              <li>
                <a className="ai-step-link" href="#step-01-detection" aria-current={activeAiStep === "step-01-detection" ? "step" : undefined} onClick={(event) => { event.preventDefault(); goToStep("step-01-detection"); }}>
                  <Pulse aria-hidden="true" /><span>01</span><strong>发现</strong><small>锁定异常窗口</small>
                </a>
              </li>
              <li>
                <a className="ai-step-link" href="#step-02-conclusion" aria-current={activeAiStep === "step-02-conclusion" ? "step" : undefined} onClick={(event) => { event.preventDefault(); goToStep("step-02-conclusion"); }}>
                  <Brain aria-hidden="true" /><span>02</span><strong>判断</strong><small>排序故障候选</small>
                </a>
              </li>
              <li>
                <a className="ai-step-link" href="#step-03-explanation" aria-current={activeAiStep === "step-03-explanation" ? "step" : undefined} onClick={(event) => { event.preventDefault(); goToStep("step-03-explanation"); }}>
                  <ChartLineUp aria-hidden="true" /><span>03</span><strong>解释</strong><small>对齐变量证据</small>
                </a>
              </li>
              <li>
                <a className="ai-step-link" href="#step-04-recommendation" aria-current={activeAiStep === "step-04-recommendation" ? "step" : undefined} onClick={(event) => { event.preventDefault(); goToStep("step-04-recommendation"); }}>
                  <ListChecks aria-hidden="true" /><span>04</span><strong>建议</strong><small>生成检查顺序</small>
                </a>
              </li>
              <li className="is-human">
                <a className="ai-step-link" href="#step-05-decision" aria-current={activeAiStep === "step-05-decision" ? "step" : undefined} onClick={(event) => { event.preventDefault(); goToStep("step-05-decision"); }}>
                  <UserFocus aria-hidden="true" /><span>05</span><strong>确认</strong><small>决定并留痕</small>
                </a>
              </li>
            </ol>

            <div className="ai-workbench">
              <section className="ai-panel ai-detection" data-ai-step="1" aria-labelledby="ai-detection-title" id="step-01-detection" tabIndex={-1}>
                <div className="ai-section-header"><div><span className="kicker">步骤 01 · AI 发现</span><h2 id="ai-detection-title">偏移何时被看见</h2></div></div>
                <p className="ai-sample-window">检测样本 {event.detectionSample} → 诊断样本 {event.diagnosisSample}</p>
                <dl className="ai-stat-grid">
                  <div><dt>首次异常分数</dt><dd>{event.anomalyScore.toFixed(2)}</dd></div>
                  <div><dt>诊断异常分数</dt><dd>{event.diagnosisAnomalyScore.toFixed(2)}</dd></div>
                  <div><dt>候选刷新延迟</dt><dd>{event.diagnosisDelaySamples}<small> 样本</small></dd></div>
                  <div><dt>告警锁存</dt><dd>{event.anomalyLatched ? "已锁定" : "未锁定"}</dd></div>
                </dl>
                <p className="ai-method-note">持续性和滞回规则先过滤瞬时噪声，再由 PCA T² / SPE 判断过程是否偏离正常空间。</p>
              </section>

              <section className="ai-panel ai-conclusion" data-ai-step="2" aria-labelledby="ai-conclusion-title" id="step-02-conclusion" tabIndex={-1}>
                <div className="ai-section-header">
                  <div><span className="kicker">步骤 02 · AI 判断</span><h2 id="ai-conclusion-title">AI 研判结论</h2></div>
                  <StatusTag state={severity.state} label={`${severity.label} · ${eventStateLabel[event.state]}`} />
                </div>
                <p className="ai-thesis">当前最可能是<strong>{topCandidate?.label ?? "候选尚未收敛"}</strong>，AI 将它排在首位的依据来自同步时间窗内的三项高贡献变量。</p>
                <p className="ai-value-prop">不只报异常，还给出故障假设与变量证据</p>
                <ol className="ai-candidate-list" aria-label="AI 故障候选排序">
                  {event.candidates.map((candidate, index) => {
                    const display = formatFaultCandidate(candidate);
                    return <li key={`${candidate.faultId}-${index}`}><span className="candidate-rank">{String(index + 1).padStart(2, "0")}</span><b>{display.code}</b><span>{display.label}</span><strong>{display.probability}</strong></li>;
                  })}
                </ol>
              </section>

              <section className="ai-panel ai-explanation" data-ai-step="3" aria-labelledby="ai-explanation-title" id="step-03-explanation" tabIndex={-1}>
                <div className="ai-section-header"><div><span className="kicker">步骤 03 · AI 解释</span><h2 id="ai-explanation-title">原因</h2></div><span className="event-window-label">同一时间窗 · 三项证据</span></div>
                <p className="ai-explanation-copy">AI 把变量变化放到同一个时间轴上比较：{event.evidence.map((item) => `${item.variableId} ${localizeIndustrialCopy(item.variableName)}`).join("、")}共同指向当前故障假设。</p>
                <EvidenceTrendChart evidence={event.evidence} />
                <div className="ai-evidence-detail"><EvidencePanel evidence={event.evidence} /><ContributionChart evidence={event.evidence} /></div>
              </section>

              <EventCopilot event={event} />

              <aside className="ai-side-stack">
                <section className="ai-panel ai-recommendation" data-ai-step="4" aria-labelledby="ai-recommendation-title" id="step-04-recommendation" tabIndex={-1}>
                  <div className="ai-section-header"><div><span className="kicker">步骤 04 · AI 建议</span><h2 id="ai-recommendation-title">AI 建议下一步</h2></div></div>
                  <p className="ai-risk-copy"><strong>风险：</strong>{localizeIndustrialCopy(event.recommendation.risk)}</p>
                  <div className="ai-action-group"><h3>先核对</h3><ol>{event.recommendation.checks.map((item) => <li key={item}>{localizeIndustrialCopy(item)}</li>)}</ol></div>
                  <div className="ai-action-group"><h3>再处置</h3><ol>{event.recommendation.actions.map((item) => <li key={item}>{localizeIndustrialCopy(item)}</li>)}</ol></div>
                  <p className="ai-safety-boundary"><strong>当前 Demo：</strong>不连接控制网、不向 PLC/DCS 写回。生产部署可在人工授权、权限校验和联锁校验通过后受控写回。</p>
                </section>

                <div className="ai-human-gate" data-ai-step="5" id="step-05-decision" tabIndex={-1}>
                  {recordHref ? <section className="decision-success" role="status"><CheckCircle weight="fill" aria-hidden="true" /><div><span className="kicker">人工确认点</span><strong>事件记录已形成</strong><span>{decisionMode === "static-demo" ? "静态 Demo 记录未写入服务器。" : "记录已写入审计服务。"}</span><Link href={recordHref}>打开审计记录</Link></div></section> : session ? (
                    <HumanDecision
                      operatorName={`${session.displayName}（${session.username}）`}
                      operatorRole={session.role}
                      onSubmit={async (payload) => { const decision = await submitDecisionWithFallback(eventId, payload); setDecisionMode(decision.mode); setRecordHref(`/records/${decision.mode === "static-demo" ? "demo-record" : decision.data.id}`); }}
                    />
                  ) : (
                    <section className="side-panel login-prompt" role="status">
                      <span className="kicker">人工确认点</span>
                      <h2>由人决定是否采纳</h2>
                      <p>AI 只提供判断、证据和检查顺序。人工决策必须绑定预置操作员身份，并写入审计记录。</p>
                      <Link className="primary-button link-button" href={`/login?next=/events/${eventId}`}>登录并确认结论</Link>
                    </section>
                  )}
                </div>
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
      <PageHeader kicker="系统状态" title="数据与模型健康" summary="核对接口、演示数据、模型版本，以及当前只读与未来受控写回边界。" />
      <ResourceBoundary {...resource}>{(result) => (
        <>
          <ModeNotice mode={result.mode} notice={result.notice} />
          <section className="system-grid">
            <div><span>应用状态</span><StatusTag state={result.data.status === "ok" ? "normal" : "warning"} label={result.data.status === "ok" ? "就绪" : "降级"} /><p>静态 Demo 可继续完成主链路。</p></div>
            <div><span>数据来源</span><strong>田纳西-伊士曼过程（TEP）</strong><p>公开仿真数据，不是真实贵州工厂数据。</p></div>
            <div><span>模型版本</span><strong>{demoEvent.modelVersion}</strong><p>双阶段偏移检测与故障候选 Demo。</p></div>
            <div><span>安全边界</span><strong>当前 Demo 只读</strong><p>生产版可经人工授权、权限校验与联锁校验后接入 PLC/DCS。</p></div>
          </section>
          <section className="table-panel"><table aria-label="系统依赖检查"><thead><tr><th scope="col">依赖</th><th scope="col">状态</th><th scope="col">说明</th></tr></thead><tbody>{Object.entries(result.data.checks ?? { api: result.data.status }).map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td><td>{name === "api" && result.mode === "static-demo" ? "API 失联，已启用静态 Demo" : "检查结果来自 readiness"}</td></tr>)}</tbody></table></section>
        </>
      )}</ResourceBoundary>
    </div>
  );
}

export const demoRunId = demoRun.id;
