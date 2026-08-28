"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { listAdminAudit, type AdminAuditPage } from "@/lib/admin-api";
import styles from "./admin-console.module.css";
import { AdminEmpty, AdminError, AdminLoading, errorMessage, formatAdminTime } from "./admin-state";

const PAGE_SIZE = 20;

export function AdminAuditPage() {
  const [data, setData] = useState<AdminAuditPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nextOffset = offset) => {
    setLoading(true);
    setError("");
    try {
      setData(await listAdminAudit({ limit: PAGE_SIZE, offset: nextOffset }));
      setOffset(nextOffset);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { void load(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <AdminLoading label="正在读取配置审计" />;
  if (error && !data) return <AdminError message={error} onRetry={() => void load(offset)} />;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>AUDIT LOG</p>
          <h2>配置审计</h2>
          <p>按管理员、动作、资源和版本查看配置变更；密钥只记录“是否变更”，不会写入审计正文。</p>
        </div>
        <button className={styles.buttonSecondary} type="button" onClick={() => void load(offset)} disabled={loading}>
          <ArrowClockwise aria-hidden="true" />{loading ? "刷新中" : "刷新"}
        </button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {!data || data.items.length === 0 ? (
        <AdminEmpty title="暂无配置审计" detail="保存 AI 配置后，变更版本与操作者会出现在这里。" />
      ) : (
        <section className={styles.panel} aria-label="管理配置审计明细">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">时间 / 操作者</th><th scope="col">动作 / 资源</th><th scope="col">变更字段</th><th scope="col">版本</th><th scope="col">请求追踪</th></tr></thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatAdminTime(item.createdAt)}<br /><strong>{item.actor}</strong></td>
                    <td>{item.action}<br /><code>{item.resourceType}:{item.resourceId}</code></td>
                    <td>{item.changeSummary.changedFields.length ? item.changeSummary.changedFields.join("、") : "无字段差异"}{item.changeSummary.apiKeyChanged ? <><br /><span className={`${styles.badge} ${styles.degraded}`}>密钥已变更</span></> : null}</td>
                    <td><code>{item.changeSummary.previousVersion}</code><br />→ <code>{item.changeSummary.currentVersion}</code></td>
                    <td><code>{item.traceId}</code><br /><code>{item.requestId}</code></td>
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
