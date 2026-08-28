"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { listAIInteractions, type AIInteractionPage } from "@/lib/admin-api";
import styles from "./admin-console.module.css";
import { AdminEmpty, AdminError, AdminLoading, errorMessage, formatAdminTime } from "./admin-state";

const PAGE_SIZE = 20;

export function AdminInteractionsPage() {
  const [data, setData] = useState<AIInteractionPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nextOffset = offset) => {
    setLoading(true);
    setError("");
    try {
      setData(await listAIInteractions({ limit: PAGE_SIZE, offset: nextOffset }));
      setOffset(nextOffset);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { void load(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <AdminLoading label="正在读取 AI 调用记录" />;
  if (error && !data) return <AdminError message={error} onRetry={() => void load(offset)} />;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>TRACEABILITY</p>
          <h2>AI 调用记录</h2>
          <p>查看问题、回答模式、证据引用、延迟与 Trace ID；记录来自真实管理 API。</p>
        </div>
        <button className={styles.buttonSecondary} type="button" onClick={() => void load(offset)} disabled={loading}>
          <ArrowClockwise aria-hidden="true" />{loading ? "刷新中" : "刷新"}
        </button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {!data || data.items.length === 0 ? (
        <AdminEmpty title="暂无 AI 调用记录" detail="当前筛选范围内没有在线 AI 交互。模板建议不会伪装为在线调用。" />
      ) : (
        <section className={styles.panel} aria-label="AI 调用明细">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">时间 / 模式</th><th scope="col">事件 / 问题</th><th scope="col">回答摘要</th><th scope="col">模型 / 延迟</th><th scope="col">Trace ID</th></tr></thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatAdminTime(item.createdAt)}<br /><span className={`${styles.badge} ${item.mode === "llm_enhanced" ? styles.ready : styles.degraded}`}>{item.mode}</span></td>
                    <td><code>{item.eventId}</code><br />{item.question}</td>
                    <td>{item.answer.length > 180 ? `${item.answer.slice(0, 180)}…` : item.answer}<br /><span className={styles.secondary}>证据 {item.evidenceRefs.length} 项</span></td>
                    <td>{item.model}<br /><code>{item.latencyMs} ms</code></td>
                    <td><code>{item.traceId}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pager}>
            <span>第 {offset + 1}–{Math.min(offset + data.items.length, data.total)} 条，共 {data.total} 条</span>
            <div>
              <button className={styles.buttonSecondary} type="button" disabled={loading || offset === 0} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
              <button className={styles.buttonSecondary} type="button" disabled={loading || offset + data.items.length >= data.total} onClick={() => void load(offset + PAGE_SIZE)}>下一页</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
