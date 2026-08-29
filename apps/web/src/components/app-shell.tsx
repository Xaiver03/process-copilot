"use client";

import {
  ClipboardText,
  Gauge,
  GearSix,
  HardDrives,
  List,
  ListMagnifyingGlass,
  Play,
  SignIn,
  SignOut,
  Warning,
  Waveform,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { clearSession, useSession } from "@/lib/auth-store";

export const navigationItems = [
  { href: "/demo", label: "演示引导", icon: Play },
  { href: "/overview", label: "运营总览", icon: Gauge },
  { href: "/replay", label: "过程回放", icon: Waveform },
  { href: "/events", label: "偏移事件", icon: ListMagnifyingGlass },
  { href: "/xifeng", label: "息烽园区场景", icon: Warning },
  { href: "/system", label: "系统状态", icon: HardDrives },
] as const;

function isCurrentRoute(pathname: string, href: string) {
  return pathname === href || (href === "/events" && pathname.startsWith("/events/"));
}

export function AppShell({
  currentPath,
  children,
}: {
  currentPath: string;
  children: ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const session = useSession();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside id="app-navigation" className={`app-sidebar${navigationOpen ? " sidebar-open" : ""}`}>
        <button className="sidebar-close" type="button" aria-label="关闭主导航" onClick={() => setNavigationOpen(false)}><X aria-hidden="true" /></button>
        <Link
          className="brand-lockup"
          href="/demo"
          aria-label="序安 Process Sentinel（序安·过程哨兵）首页"
        >
          <span className="brand-mark" aria-hidden="true"><Image src="/brand/process-sentinel-mark-v01.png" alt="" width={38} height={38} priority /></span>
          <span><strong>序安</strong><small>PROCESS SENTINEL</small></span>
        </Link>
        <nav aria-label="主导航">
          {[...navigationItems, ...(session?.role === "admin"
            ? [{ href: "/admin", label: "管理后台", icon: GearSix }]
            : [])].map(({ href, label, icon: Icon }) => {
            const active = isCurrentRoute(currentPath, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setNavigationOpen(false)}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-boundary">
          <ClipboardText aria-hidden="true" />
          <p><strong>当前 Demo 只读</strong><span>生产版支持受控写回</span></p>
        </div>
      </aside>
      {navigationOpen ? <button className="sidebar-scrim" type="button" aria-label="关闭侧栏遮罩" onClick={() => setNavigationOpen(false)} /> : null}
      <div className="app-workspace">
        <header className="context-bar">
          <button className="sidebar-trigger" type="button" aria-label="打开主导航" aria-controls="app-navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><List aria-hidden="true" /></button>
          <div><span>TEP 仿真装置</span><strong>连续过程监控工作区</strong></div>
          <span className="source-chip">公开仿真数据</span>
          {session ? (
            <div className="operator-badge">
              <span className={`role-chip role-${session.role}`}>{session.displayName}</span>
              <button type="button" className="text-link" onClick={clearSession}>
                <SignOut aria-hidden="true" /> 退出
              </button>
            </div>
          ) : (
            <Link className="text-link" href="/login"><SignIn aria-hidden="true" /> 操作员登录</Link>
          )}
        </header>
        <main id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
