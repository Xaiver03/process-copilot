"use client";

import {
  CheckCircle,
  ClockCounterClockwise,
  Warning,
  WarningCircle,
  WifiHigh,
  WifiSlash,
} from "@phosphor-icons/react";
import { FormEvent, useState } from "react";

import type { components } from "@/lib/api-schema";
import { formatContribution, formatEvidenceSummary, localizeIndustrialCopy } from "@/lib/presentation";

type Evidence = components["schemas"]["EvidenceItem"];
type DecisionRequest = components["schemas"]["DecisionRequest"];

const statusIcons = {
  normal: <CheckCircle aria-hidden="true" weight="fill" />,
  warning: <Warning aria-hidden="true" weight="fill" />,
  critical: <WarningCircle aria-hidden="true" weight="fill" />,
};

export function StatusTag({
  state,
  label,
}: {
  state: keyof typeof statusIcons;
  label: string;
}) {
  return (
    <span className={`status-tag status-${state}`}>
      {statusIcons[state]}
      <span>{label}</span>
    </span>
  );
}

export function DataFreshness({
  state,
  lastUpdated,
}: {
  state: "live" | "delayed" | "offline";
  lastUpdated: string;
}) {
  const copy = {
    live: ["数据在线", <WifiHigh key="live" aria-hidden="true" />],
    delayed: ["数据延迟", <ClockCounterClockwise key="delayed" aria-hidden="true" />],
    offline: ["数据离线", <WifiSlash key="offline" aria-hidden="true" />],
  } as const;
  return (
    <div className={`freshness freshness-${state}`}>
      {copy[state][1]}
      <span>{copy[state][0]}</span>
      <small>最后有效数据 {new Date(lastUpdated).toLocaleString("zh-CN", { hour12: false })}</small>
    </div>
  );
}

export function EvidencePanel({ evidence }: { evidence: Evidence[] }) {
  const topThree = evidence.slice(0, 3);
  return (
    <section aria-labelledby="evidence-title" className="evidence-panel">
      <div className="section-heading">
        <div>
          <span className="kicker">同步时间窗</span>
          <h2 id="evidence-title">Top-3 关键变量证据</h2>
        </div>
        <span role="status" className="sr-only">
          三项关键变量证据已按贡献度排列
        </span>
      </div>
      <div className="evidence-tracks">
        {topThree.map((item) => (
          <article key={item.variableId} className="evidence-track">
            <div>
              <code>{item.variableId}</code>
              <strong>{localizeIndustrialCopy(item.variableName)}</strong>
              <p>{formatEvidenceSummary(item)}</p>
            </div>
            <div className="spark-placeholder" aria-hidden="true">
              {item.values.map((value, index) => (
                <i
                  key={`${item.variableId}-${index}`}
                  style={{ height: `${18 + ((value * 7) % 34)}%` }}
                />
              ))}
            </div>
            <b>{formatContribution(item.contribution)}</b>
          </article>
        ))}
      </div>
      <details className="data-table-disclosure">
        <summary>查看证据数据表</summary>
        <table aria-label="关键变量证据数据表">
          <thead>
            <tr><th scope="col">变量</th><th scope="col">方向</th><th scope="col">SPE 贡献值</th><th scope="col">最新值</th></tr>
          </thead>
          <tbody>
            {topThree.map((item) => (
              <tr key={item.variableId}>
                <th scope="row">{item.variableId} {localizeIndustrialCopy(item.variableName)}</th>
                <td>{item.direction === "up" ? "上升" : item.direction === "down" ? "下降" : "混合"}</td>
                <td>{formatContribution(item.contribution)}</td>
                <td>{item.values.at(-1)} {item.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function HumanDecision({
  operatorName,
  operatorRole,
  onSubmit,
}: {
  operatorName: string;
  operatorRole: "operator" | "shift_lead" | "admin";
  onSubmit: (decision: DecisionRequest) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const shiftLead = operatorRole === "shift_lead" || operatorRole === "admin";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: DecisionRequest = {
      decision: form.get("decision") as DecisionRequest["decision"],
      decisionMethod: form.get("decisionMethod") as DecisionRequest["decisionMethod"],
      note: String(form.get("note") ?? "").trim(),
    };
    if (!payload.note) {
      setError("请填写研判说明。 ");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(payload);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "未知错误";
      setError(`记录提交失败：${detail}。请保留当前页面并重试。`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="decision-form" onSubmit={handleSubmit} aria-labelledby="decision-title">
      <div>
        <span className="kicker">人工确认点</span>
        <h2 id="decision-title">形成事件记录</h2>
      </div>
      <p className="operator-identity">
        当前操作者：<strong>{operatorName}</strong>
        <span className={`role-chip role-${operatorRole}`}>
          {shiftLead ? "班长权限：可确认 / 驳回" : "操作员权限：仅可升级上报"}
        </span>
      </p>
      <label>
        研判结论
        <select name="decision" defaultValue={shiftLead ? "confirm" : "escalate"}>
          {shiftLead ? <option value="confirm">确认偏移</option> : null}
          {shiftLead ? <option value="reject">驳回偏移</option> : null}
          <option value="escalate">升级处理</option>
        </select>
      </label>
      <label>
        建议采纳情况
        <select name="decisionMethod" defaultValue="followed">
          <option value="followed">按建议执行</option>
          <option value="partially_followed">部分采纳</option>
          <option value="overridden">未采纳，改用其他方案</option>
        </select>
      </label>
      <label>
        研判说明
        <textarea name="note" rows={3} maxLength={1000} required />
      </label>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "正在形成记录" : "确认并形成记录"}
      </button>
      <p className="safety-note">当前 Demo 只记录人工研判，不连接控制网；生产版可在安全校验通过后受控写回 PLC/DCS。</p>
    </form>
  );
}
