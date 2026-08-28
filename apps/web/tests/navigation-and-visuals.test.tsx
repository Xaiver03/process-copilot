import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { productTokens } from "@process-copilot/ui";

import { AppShell, navigationItems } from "@/components/app-shell";
import { saveSession } from "@/lib/auth-store";
import { StatePanel } from "@/components/state-panel";
import {
  createEvidenceTrendOption,
  createProcessHeatmapOption,
  processVariables,
} from "@/lib/chart-options";
import { demoEvent } from "@/lib/demo-data";

describe("应用框架与路由", () => {
  it("产品语义 token 只引用 Wuno 核心 token", () => {
    expect(productTokens.processAlarm).toBe("var(--wuno-status-error)");
    expect(productTokens.evidenceSelected).toBe("var(--wuno-primary-700)");
    expect(productTokens.chartGrid).toBe("var(--wuno-border-subtle)");
  });

  it("提供全部产品路由并高亮当前位置", () => {
    const routes = navigationItems.map((item) => item.href);
    expect(routes).toEqual(["/demo", "/overview", "/replay", "/events", "/system"]);

    const { container } = render(<AppShell currentPath="/events/demo-event"><p>内容</p></AppShell>);
    expect(
      screen.getByRole("link", { name: "序安 Process Sentinel（序安·过程哨兵）首页" }),
    ).toBeInTheDocument();
    expect(screen.getByText("序安")).toBeInTheDocument();
    expect(screen.getByText("PROCESS SENTINEL")).toBeInTheDocument();
    expect(container.querySelector('img[src*="process-sentinel-mark-v01"]')).toBeInTheDocument();
    expect(screen.queryByText(/WUNO/i)).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /偏移事件/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute("href", "#main-content");
  });

  it("小屏可用按钮打开并关闭侧栏抽屉", async () => {
    const user = userEvent.setup();
    render(<AppShell currentPath="/overview"><p>内容</p></AppShell>);

    await user.click(screen.getByRole("button", { name: "打开主导航" }));
    expect(screen.getByRole("complementary")).toHaveClass("sidebar-open");
    await user.click(screen.getByRole("button", { name: "关闭主导航" }));
    expect(screen.getByRole("complementary")).not.toHaveClass("sidebar-open");
  });

  it("仅向系统管理员显示管理后台入口", async () => {
    const expiresAt = "2099-01-01T00:00:00Z";
    const { rerender } = render(<AppShell currentPath="/overview"><p>内容</p></AppShell>);
    expect(screen.queryByRole("link", { name: "管理后台" })).not.toBeInTheDocument();

    saveSession({
      token: "admin-token",
      username: "system-admin",
      role: "admin",
      displayName: "系统管理员",
      expiresAt,
    });
    rerender(<AppShell currentPath="/admin"><p>内容</p></AppShell>);

    expect(await screen.findByRole("link", { name: "管理后台" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("工业图表约束", () => {
  it("52 路变量总览使用热力图而不是叠加折线", () => {
    const option = createProcessHeatmapOption();
    expect(processVariables).toHaveLength(52);
    expect(option.series).toHaveLength(1);
    expect(option.series?.[0]).toMatchObject({ type: "heatmap" });
  });

  it("三项证据使用三个网格和共享时间刻度的小多图", () => {
    const option = createEvidenceTrendOption(demoEvent.evidence);
    expect(option.grid).toHaveLength(3);
    expect(option.series).toHaveLength(3);
    expect(option.series?.every((series) => series.type === "line")).toBe(true);
  });
});

describe("全状态", () => {
  it.each([
    ["loading", "正在读取过程数据"],
    ["error", "数据读取失败"],
    ["empty", "当前没有偏移事件"],
    ["degraded", "静态 Demo 降级"],
    ["read-only", "当前 Demo 只读"],
  ] as const)("渲染 %s 状态", (state, copy) => {
    render(<StatePanel state={state} />);
    expect(screen.getByText(copy)).toBeInTheDocument();
  });
});
