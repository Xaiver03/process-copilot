"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { components } from "@/lib/api-schema";
import { getScenariosWithFallback, startScenarioWithFallback, type ApiResult } from "@/lib/api-client";
import { ModeNotice } from "./mode-notice";

type Scenario = components["schemas"]["Scenario"];
type ReplayRun = components["schemas"]["ReplayRun"];
type AnomalyEvent = components["schemas"]["AnomalyEvent"];

export function DemoJourney() {
  const [scenarios, setScenarios] = useState<ApiResult<Scenario[]> | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [journey, setJourney] = useState<ApiResult<{ run: ReplayRun; event: AnomalyEvent }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getScenariosWithFallback().then((result) => {
      if (!active) return;
      setScenarios(result);
      setSelectedId(result.data[0]?.id ?? "");
    }).catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : "场景读取失败"));
    return () => { active = false; };
  }, [loadRevision]);

  async function start() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    setJourney(null);
    try {
      setJourney(await startScenarioWithFallback(selectedId, 10));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回放创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="demo-stage">
      <span className="kicker">现场主链路</span>
      <h1>选择场景并创建真实回放</h1>
      <p>创建 run 后立即读取该 run 的事件，研判和记录全程使用后端返回 ID。</p>
      {scenarios ? <ModeNotice mode={scenarios.mode} notice={scenarios.notice} /> : null}
      <label className="demo-scenario-field">
        演示场景
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={!scenarios || busy}>
          {scenarios?.data.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
        </select>
      </label>
      {error ? <div className="form-error" role="alert"><strong>操作失败</strong><p>{error}</p>{!scenarios ? <button className="text-link" type="button" onClick={() => { setError(""); setLoadRevision((value) => value + 1); }}>重试读取场景</button> : null}</div> : null}
      <button className="primary-button" type="button" onClick={start} disabled={!selectedId || busy}>
        {busy ? "正在创建并读取事件" : "创建回放并读取事件"}
      </button>
      {journey ? (
        <div className="result-stage" role="status">
          <ModeNotice mode={journey.mode} notice={journey.notice} />
          <p>Run <code>{journey.data.run.id}</code></p>
          <p>Event <code>{journey.data.event.id}</code></p>
          <Link className="primary-button link-button" href={journey.mode === "static-demo" ? "/events/demo-event" : `/events/${journey.data.event.id}`}>
            {journey.mode === "static-demo" ? "进入静态事件研判" : "进入真实事件研判"}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
