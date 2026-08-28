"use client";

import { ShieldCheck, SignIn } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, FormEvent, useState } from "react";

import { login } from "@/lib/api-client";
import { useAuthSession } from "@/lib/auth-store";

const PRESET_ACCOUNTS = [
  { username: "system-admin", password: "demo-admin-2026", label: "系统管理员", hint: "AI 配置与审计权限" },
  { username: "operator-01", password: "demo-op-2026", label: "中控操作员 01", hint: "仅可升级上报" },
  { username: "shift-lead", password: "demo-lead-2026", label: "当班班长", hint: "可确认 / 驳回" },
  { username: "process-engineer", password: "demo-eng-2026", label: "工艺工程师", hint: "可确认 / 驳回" },
];

function safeNextPath(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/events";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = safeNextPath(params.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login({ username, password });
      router.push(nextPath);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "未知错误";
      setError(`登录失败：${detail}`);
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} aria-labelledby="login-title">
      <label>
        操作员账号
        <input
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label>
        口令
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={submitting}>
        <SignIn aria-hidden="true" />
        {submitting ? "正在验证" : "登录中控工作台"}
      </button>
      <p className="safety-note">演示系统不开放自助注册，账号由系统预置；令牌 12 小时（一个班次）后自动过期。</p>
      <div className="preset-accounts">
        <span className="kicker">演示预置账号</span>
        <ul>
          {PRESET_ACCOUNTS.map((account) => (
            <li key={account.username}>
              <button
                type="button"
                onClick={() => { setUsername(account.username); setPassword(account.password); }}
              >
                <strong>{account.label}</strong>
                <code>{account.username}</code>
                <small>{account.hint}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}

export default function LoginPage() {
  const session = useAuthSession();
  const isAdmin = session?.role === "admin";

  return (
    <div className="page-stack login-page">
      <header className="page-header">
        <span className="kicker">身份认证</span>
        <h1>操作员登录</h1>
        <p>人工研判与决策留痕必须绑定操作员身份。确认 / 驳回需要班长或工程师权限。</p>
      </header>
      {session ? (
        <section className="side-panel" role="status">
          <span className="kicker">已登录</span>
          <h2>{session.displayName}（{session.username}）</h2>
          <p className="operator-identity">
            当前权限：
            <span className={`role-chip role-${session.role}`}>
              {isAdmin
                ? "管理员权限：可维护 AI 配置与查看审计"
                : session.role === "shift_lead"
                  ? "班长权限：可确认 / 驳回"
                  : "操作员权限：仅可升级上报"}
            </span>
          </p>
          <Link className="primary-button link-button" href={isAdmin ? "/admin" : "/events"}>
            {isAdmin ? "进入系统管理后台" : "进入偏移事件队列"}
          </Link>
        </section>
      ) : (
        <section className="side-panel">
          <span className="kicker"><ShieldCheck aria-hidden="true" /> 预置账号</span>
          <Suspense fallback={<p>加载登录表单…</p>}>
            <LoginForm />
          </Suspense>
        </section>
      )}
    </div>
  );
}
