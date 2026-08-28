"use client";

import { Brain, ClipboardText, GearSix, Gauge, LockKey } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { isAdmin, useAuthSession } from "@/lib/auth-store";
import styles from "./admin-console.module.css";

const adminNavigation = [
  { href: "/admin", label: "运行概览", icon: Gauge },
  { href: "/admin/ai", label: "AI 配置", icon: Brain },
  { href: "/admin/interactions", label: "调用记录", icon: ClipboardText },
  { href: "/admin/audit", label: "配置审计", icon: GearSix },
];

export function AdminAccess({ children }: { children: ReactNode }) {
  const session = useAuthSession();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return <div className={styles.state} role="status">正在验证管理员身份…</div>;
  }
  if (!session) {
    return (
      <section className={styles.accessPanel} aria-labelledby="admin-login-title">
        <LockKey aria-hidden="true" />
        <h1 id="admin-login-title">需要管理员登录</h1>
        <p>管理后台不支持匿名访问。请使用系统管理员预置账号登录。</p>
        <Link href="/login?next=/admin">前往身份认证</Link>
      </section>
    );
  }
  if (!isAdmin(session)) {
    return (
      <section className={styles.accessPanel} aria-labelledby="admin-denied-title">
        <LockKey aria-hidden="true" />
        <h1 id="admin-denied-title">无权访问管理后台</h1>
        <p>当前账号为 {session.displayName}（{session.role}）。AI 配置、调用记录和审计仅向系统管理员开放。</p>
        <Link href="/overview">返回运行总览</Link>
      </section>
    );
  }
  return <>{children}</>;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useAuthSession();

  return (
    <AdminAccess>
      <div className={styles.root}>
        <header className={styles.masthead}>
          <div>
            <p className={styles.eyebrow}>SYSTEM ADMINISTRATION</p>
            <h1>序安管理控制台</h1>
          </div>
          <div className={styles.identity}>
            <strong>{session?.displayName ?? "系统管理员"}</strong>
            <span>{session?.username ?? "system-admin"} · 变更全程留痕</span>
          </div>
        </header>
        <nav className={styles.nav} aria-label="管理后台导航">
          {adminNavigation.map((item) => {
            const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                <Icon aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </AdminAccess>
  );
}
