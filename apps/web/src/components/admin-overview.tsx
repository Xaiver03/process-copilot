"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { getAdminOverview, type AdminOverview } from "@/lib/admin-api";
import styles from "./admin-console.module.css";
import { AdminEmpty, AdminError, AdminLoading, errorMessage, formatAdminTime } from "./admin-state";

type ServiceState = AdminOverview["worker"]["status"];

const serviceLabels: Record<ServiceState, string> = {
  ready: "就绪",
  degraded: "降级",
  offline: "离线",
  unknown: "未知",
};

const interactionModeLabels: Record<AdminOverview["recentLLMCalls"][number]["mode"], string> = {
  llm_enhanced: "在线增强",
  template: "模板降级",
  degraded: "服务降级",
};

function ServiceCard({ title, service }: { title: string; service: AdminOverview["worker"] }) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span>{title}</span>
        <span className={`${styles.badge} ${styles[service.status]}`}>{serviceLabels[service.status]}</span>
      </div>
      <strong>{service.version ?? "版本未上报"}</strong>
      <code>{service.latencyMs == null ? "延迟未上报" : `${service.latencyMs} ms`}</code>
      {service.reason ? <p className={styles.secondary}>{service.reason}</p> : null}
    </article>
  );
}

export function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getAdminOverview());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <AdminLoading label="正在读取 AI 与推理运行状态" />;
  if (error) return <AdminError message={error} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>OPERATIONS</p>
          <h2>AI 运行概览</h2>
          <p>确认在线推理、工业模型和语言模型的真实可用状态，不把降级结果伪装成在线调用。</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.buttonSecondary} type="button" onClick={() => void load()}>
            <ArrowClockwise aria-hidden="true" />刷新状态
          </button>
        </div>
      </header>

      <section className={styles.statusGrid} aria-label="服务状态摘要">
        <article className={styles.card}>
          <div className={styles.cardHead}><span>推理模式</span></div>
          <strong>{data.inferenceMode === "online" ? "在线 AI" : "模板降级"}</strong>
          <code>{data.dataBuildHash === "unavailable" ? "数据版本未上报" : data.dataBuildHash}</code>
        </article>
        <ServiceCard title="任务 Worker" service={data.worker} />
        <ServiceCard title="工业模型" service={data.industrialModel} />
        <ServiceCard title="语言模型" service={data.languageModel} />
      </section>

      <section className={styles.overviewGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3>最近 AI 调用</h3>
            <span>{data.recentLLMCalls.length} 条</span>
          </div>
          {data.recentLLMCalls.length === 0 ? (
            <AdminEmpty title="暂无 AI 调用" detail="完成事件追问或连接测试后，调用会在这里出现。" />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th scope="col">时间</th><th scope="col">模式</th><th scope="col">模型</th><th scope="col">延迟</th><th scope="col">Trace ID</th></tr></thead>
                <tbody>
                  {data.recentLLMCalls.map((item) => (
                    <tr key={item.id}>
                      <td>{formatAdminTime(item.createdAt)}</td>
                      <td><span className={`${styles.badge} ${item.mode === "llm_enhanced" ? styles.ready : styles.degraded}`}>{interactionModeLabels[item.mode]}</span></td>
                      <td>{item.model}</td>
                      <td>{item.latencyMs} ms</td>
                      <td><code>{item.traceId}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className={styles.panel} aria-labelledby="degraded-title">
          <div className={styles.panelHeader}><h3 id="degraded-title">降级原因</h3><span>{data.degradedReasons.length} 项</span></div>
          {data.degradedReasons.length ? (
            <ul className={styles.reasonList}>{data.degradedReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          ) : (
            <div className={styles.success} role="status">当前未上报降级原因。</div>
          )}
        </aside>
      </section>
    </div>
  );
}
