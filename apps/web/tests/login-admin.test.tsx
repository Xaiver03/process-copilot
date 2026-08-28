import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", () => ({ login: vi.fn() }));

import LoginPage from "@/app/login/page";
import { saveSession } from "@/lib/auth-store";

describe("管理员演示登录", () => {
  beforeEach(() => window.localStorage.clear());

  it("提供 system-admin 一键填充且明确不开放注册", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /系统管理员/ }));
    expect(screen.getByRole("textbox", { name: "操作员账号" })).toHaveValue("system-admin");
    expect(screen.getByLabelText("口令")).toHaveValue("demo-admin-2026");
    expect(screen.getByText(/不开放自助注册/)).toBeInTheDocument();
  });

  it("已登录管理员显示后台入口与正确权限文案", async () => {
    saveSession({
      token: "admin-token",
      username: "system-admin",
      role: "admin",
      displayName: "系统管理员",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    render(<LoginPage />);

    expect(await screen.findByText("管理员权限：可维护 AI 配置与查看审计")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入系统管理后台" })).toHaveAttribute("href", "/admin");
  });
});
