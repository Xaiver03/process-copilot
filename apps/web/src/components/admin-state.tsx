"use client";

import { CircleNotch, Database, WarningCircle } from "@phosphor-icons/react";

import styles from "./admin-console.module.css";

export function AdminLoading({ label = "正在读取管理数据" }: { label?: string }) {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <CircleNotch aria-hidden="true" />
      <strong>{label}</strong>
      <p>正在验证管理员身份并连接管理 API。</p>
    </div>
  );
}

export function AdminError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.state} role="alert">
      <WarningCircle aria-hidden="true" />
      <strong>管理数据读取失败</strong>
      <p>{message}</p>
      <button className={styles.buttonSecondary} type="button" onClick={onRetry}>重试</button>
    </div>
  );
}

export function AdminEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.empty} role="status">
      <Database aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误，请稍后重试。";
}

export function formatAdminTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
