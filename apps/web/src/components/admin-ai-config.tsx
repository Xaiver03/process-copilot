"use client";

import { FloppyDisk, PlugsConnected } from "@phosphor-icons/react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  getAIConfig,
  getAIStatus,
  testAIConnection,
  updateAIConfig,
  type AdminAIConfigDraft,
  type AIConfig,
  type AIStatus,
} from "@/lib/admin-api";
import styles from "./admin-console.module.css";
import { AdminError, AdminLoading, errorMessage } from "./admin-state";

const runtimeStatusLabels: Record<AIStatus["languageModel"]["status"], string> = {
  ready: "已验证可用",
  degraded: "降级",
  offline: "离线",
  unknown: "未知",
};

function toDraft(config: AIConfig): AdminAIConfigDraft {
  return { ...config, apiKey: "", clearApiKey: false };
}

export function AdminAIConfig() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [draft, setDraft] = useState<AdminAIConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextConfig, nextStatus] = await Promise.all([getAIConfig(), getAIStatus()]);
      setConfig(nextConfig);
      setDraft(toDraft(nextConfig));
      setStatus(nextStatus);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function setField<K extends keyof AdminAIConfigDraft>(key: K, value: AdminAIConfigDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updated = await updateAIConfig(draft);
      setConfig(updated);
      setDraft(toDraft(updated));
      setNotice(
        draft.clearApiKey
          ? "配置已提交并写入配置审计；已保存密钥已显式清除。运行状态尚未重新探测。"
          : "配置已提交并写入配置审计。密钥内容不会回显；保存不代表运行时已在线。",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function runConnectionTest() {
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const result = await testAIConnection();
      setNotice(result.ok
        ? `本次真实探测通过：${result.provider} / ${result.model}，${result.latencyMs} ms，Trace ${result.traceId}。这只代表本次探测，不代表后续请求持续在线。`
        : `本次真实探测未通过：${result.error ?? "服务返回降级结果"}。结果已进入调用审计。`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <AdminLoading label="正在读取 AI 运行配置与最近探测状态" />;
  if (!draft || !config || !status) return <AdminError message={error || "配置响应为空。"} onRetry={() => void load()} />;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>AI RUNTIME ADMIN</p>
          <h2>AI 运行配置</h2>
          <p>配置写入和运行探测是两件事：这里仅写入 AI 服务配置，不会写入 DCS/PLC；运行状态以最近一次真实探测为准。所有配置变更、探测和调用均可追溯。</p>
        </div>
        <span className={`${styles.badge} ${styles[status.languageModel.status]}`}>
          语言模型：{runtimeStatusLabels[status.languageModel.status]}
        </span>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.success} role="status" aria-live="polite">{notice}</div> : null}
      {!draft.enabled ? <div className={styles.notice} role="status">在线增强当前已禁用；事件研判将按后端策略进入模板或降级模式。启用配置不会自动写入 DCS/PLC。</div> : null}
      {status.languageModel.reason ? <div className={styles.notice} role="status">最近探测说明：{status.languageModel.reason}</div> : null}

      <form className={`${styles.panel} ${styles.form}`} onSubmit={save}>
        <label className={styles.field}>
          <span>Provider</span>
          <input value={draft.provider} onChange={(event) => setField("provider", event.target.value)} required disabled={saving} />
        </label>
        <label className={styles.field}>
          <span>模型</span>
          <input value={draft.model} onChange={(event) => setField("model", event.target.value)} required disabled={saving} />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Base URL</span>
          <input type="url" value={draft.baseUrl} onChange={(event) => setField("baseUrl", event.target.value)} required disabled={saving} />
        </label>
        <label className={styles.field}>
          <span>超时（ms）</span>
          <input type="number" min="1000" step="100" value={draft.timeoutMs} onChange={(event) => setField("timeoutMs", event.target.valueAsNumber)} required disabled={saving} />
        </label>
        <label className={styles.field}>
          <span>最大 Token</span>
          <input type="number" min="1" value={draft.maxTokens} onChange={(event) => setField("maxTokens", event.target.valueAsNumber)} required disabled={saving} />
        </label>
        <label className={styles.field}>
          <span>Temperature</span>
          <input type="number" min="0" max="2" step="0.1" value={draft.temperature} onChange={(event) => setField("temperature", event.target.valueAsNumber)} required disabled={saving} />
        </label>
        <label className={styles.field}>
          <span>Prompt 版本</span>
          <input value={draft.promptVersion} onChange={(event) => setField("promptVersion", event.target.value)} required disabled={saving} />
        </label>
        <label className={styles.field}>
          <span>降级策略</span>
          <select value={draft.fallbackPolicy} onChange={(event) => setField("fallbackPolicy", event.target.value as AdminAIConfigDraft["fallbackPolicy"])} disabled={saving}>
            <option value="template">模板建议</option>
            <option value="degraded">仅标记降级</option>
          </select>
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setField("enabled", event.target.checked)} disabled={saving} />
          <span>启用在线语言模型增强</span>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>API 密钥（只写）</span>
          <input
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            onChange={(event) => setField("apiKey", event.target.value)}
            placeholder="输入新密钥；留空不变"
            disabled={saving || draft.clearApiKey}
          />
          <small className={styles.hint}>{config.apiKeyConfigured ? "已配置；留空将保留现有密钥" : "尚未配置；保存前请输入密钥或保持禁用"}</small>
        </label>
        <label className={`${styles.checkRow} ${styles.fieldWide}`}>
          <input
            type="checkbox"
            checked={draft.clearApiKey}
            onChange={(event) => setField("clearApiKey", event.target.checked)}
            disabled={saving || !config.apiKeyConfigured}
          />
          <span>显式清除已保存密钥</span>
        </label>

        <div className={styles.formFooter}>
          <p className={styles.hint}>密钥值不会出现在配置响应、调用记录或审计详情中。保存只提交配置并写入审计；此状态来自刚刚读取的运行时探测。</p>
          <div className={styles.actions}>
            <button className={styles.buttonSecondary} type="button" onClick={() => void runConnectionTest()} disabled={saving || testing || !draft.enabled}>
              <PlugsConnected aria-hidden="true" />{testing ? "正在测试" : "测试连接"}
            </button>
            <button className={draft.clearApiKey ? styles.buttonDanger : styles.buttonPrimary} type="submit" disabled={saving || testing}>
              <FloppyDisk aria-hidden="true" />{saving ? "正在保存" : "保存配置"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
