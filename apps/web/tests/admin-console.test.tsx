import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/ai" }));

const mocks = vi.hoisted(() => ({
  getAdminOverview: vi.fn(),
  getAIConfig: vi.fn(),
  getAIStatus: vi.fn(),
  updateAIConfig: vi.fn(),
  testAIConnection: vi.fn(),
  listAIInteractions: vi.fn(),
  listAdminAudit: vi.fn(),
}));

vi.mock("@/lib/admin-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-api")>("@/lib/admin-api");
  return { ...actual, ...mocks };
});

import { AdminAccess } from "@/components/admin-shell";
import { AdminAIConfig } from "@/components/admin-ai-config";
import { AdminInteractionsPage } from "@/components/admin-interactions";
import { AdminOverviewPage } from "@/components/admin-overview";
import { saveSession } from "@/lib/auth-store";

const adminSession = {
  token: "admin-token",
  username: "system-admin",
  role: "admin" as const,
  displayName: "系统管理员",
  expiresAt: "2099-01-01T00:00:00Z",
};

const config = {
  provider: "openai-compatible",
  baseUrl: "https://example.test/v1",
  model: "model-a",
  enabled: true,
  timeoutMs: 12000,
  maxTokens: 800,
  temperature: 0.2,
  promptVersion: "v1",
  fallbackPolicy: "template" as const,
  apiKeyConfigured: true,
};

describe("admin 权限和 AI 配置", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.getAIConfig.mockResolvedValue(config);
    mocks.getAdminOverview.mockResolvedValue({
      inferenceMode: "online",
      worker: { status: "ready", version: "worker", latencyMs: null },
      industrialModel: { status: "ready", version: "model-v1", latencyMs: null },
      languageModel: { status: "offline", version: null, latencyMs: null, reason: "语言模型增强未启用" },
      dataBuildHash: "unavailable",
      recentLLMCalls: [{
        id: "interaction-1",
        eventId: "event-1",
        question: "为什么？",
        answer: "模板回答",
        mode: "template",
        model: "template-v0.1",
        evidenceRefs: [],
        latencyMs: 0,
        traceId: "trace-1",
        createdAt: "2026-08-28T00:00:00Z",
      }],
      degradedReasons: ["语言模型增强未启用"],
    });
    mocks.getAIStatus.mockResolvedValue({
      inferenceMode: "online",
      worker: { status: "ready" },
      industrialModel: { status: "ready" },
      languageModel: { status: "ready" },
      dataBuildHash: "build-1",
    });
    mocks.updateAIConfig.mockResolvedValue(config);
    mocks.listAIInteractions.mockResolvedValue({ items: [], total: 0 });
    mocks.listAdminAudit.mockResolvedValue({ items: [], total: 0 });
  });

  it.each(["operator", "shift_lead"] as const)("拒绝 %s 进入管理后台", async (role) => {
    saveSession({ ...adminSession, role });
    render(<AdminAccess><p>管理员内容</p></AdminAccess>);

    expect(await screen.findByRole("heading", { name: "无权访问管理后台" })).toBeInTheDocument();
    expect(screen.queryByText("管理员内容")).not.toBeInTheDocument();
  });

  it("管理员可访问，并且配置加载完成前显示明确 loading", async () => {
    saveSession(adminSession);
    render(<AdminAccess><AdminAIConfig /></AdminAccess>);

    expect(screen.getByRole("status")).toHaveTextContent(/正在读取|正在验证/);
    expect(await screen.findByRole("heading", { name: "AI 运行配置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "提示词工程" })).toBeInTheDocument();
    expect(screen.getByText("当前版本 v1")).toBeInTheDocument();
    expect(screen.getByText(/输入证据边界/)).toBeInTheDocument();
    expect(screen.getByText(/evidenceRefs/)).toBeInTheDocument();
    expect(screen.getByText(/Read-only advice/)).toBeInTheDocument();
    expect(screen.getByText("语言模型：已验证可用")).toBeInTheDocument();
    expect(screen.getByText(/此状态来自刚刚读取的运行时探测/)).toBeInTheDocument();
    expect(screen.getByText(/保存只提交配置并写入审计/)).toBeInTheDocument();
  });

  it("留空保留密钥，勾选后才显式清除", async () => {
    const user = userEvent.setup();
    saveSession(adminSession);
    render(<AdminAccess><AdminAIConfig /></AdminAccess>);
    await screen.findByDisplayValue("model-a");

    expect(screen.getByText("已配置；留空将保留现有密钥")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(mocks.updateAIConfig).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "",
      clearApiKey: false,
    })));

    await user.click(screen.getByRole("checkbox", { name: "显式清除已保存密钥" }));
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(mocks.updateAIConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      clearApiKey: true,
    })));
  });

  it("错误可重试、空记录明确、禁用状态不可测试连接", async () => {
    const user = userEvent.setup();
    saveSession(adminSession);
    mocks.getAIConfig.mockRejectedValueOnce(new Error("配置服务不可达"));
    const view = render(<AdminAccess><AdminAIConfig /></AdminAccess>);

    expect(await screen.findByRole("alert")).toHaveTextContent("配置服务不可达");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByDisplayValue("model-a")).toBeInTheDocument();

    view.rerender(<AdminAccess><AdminInteractionsPage /></AdminAccess>);
    expect(await screen.findByText("暂无 AI 调用记录")).toBeInTheDocument();

    view.unmount();
    mocks.getAIConfig.mockResolvedValue({ ...config, enabled: false });
    render(<AdminAccess><AdminAIConfig /></AdminAccess>);
    expect(await screen.findByText(/在线增强当前已禁用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
  });

  it("运行概览将空值和调用模式显示为中文业务状态", async () => {
    render(<AdminOverviewPage />);

    expect(await screen.findByRole("heading", { name: "AI 运行概览" })).toBeInTheDocument();
    expect(screen.getAllByText("延迟未上报")).toHaveLength(3);
    expect(screen.getByText("数据版本未上报")).toBeInTheDocument();
    expect(screen.getByText("模板降级", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("null ms")).not.toBeInTheDocument();
    expect(screen.queryByText("unavailable")).not.toBeInTheDocument();
    expect(screen.getByText(/状态更新时间：未提供/)).toBeInTheDocument();
    expect(screen.getByText(/不是持续在线承诺/)).toBeInTheDocument();
  });

  it("区分未知、离线和降级，并展示最近探测错误", async () => {
    mocks.getAdminOverview.mockResolvedValueOnce({
      inferenceMode: "template",
      worker: { status: "unknown", version: null, latencyMs: null, reason: "尚未执行探测" },
      industrialModel: { status: "degraded", version: "model-v1", latencyMs: 24, reason: "模型探测超时" },
      languageModel: { status: "offline", version: null, latencyMs: null, reason: "最近一次探测失败：连接被拒绝" },
      dataBuildHash: "unavailable",
      recentLLMCalls: [],
      degradedReasons: ["语言模型最近一次探测失败"],
    });

    render(<AdminOverviewPage />);

    expect(await screen.findByText("未知")).toBeInTheDocument();
    expect(screen.getByText("离线")).toBeInTheDocument();
    expect(screen.getByText("降级")).toBeInTheDocument();
    expect(screen.getByText("最近一次探测失败：连接被拒绝")).toBeInTheDocument();
    expect(screen.getByText(/运行状态不是配置是否启用/)).toBeInTheDocument();
  });

  it("测试连接只报告单次真实探测，不宣称持续在线", async () => {
    const user = userEvent.setup();
    mocks.testAIConnection.mockResolvedValueOnce({
      ok: true,
      mode: "llm_enhanced",
      provider: "openai-compatible",
      model: "model-a",
      latencyMs: 42,
      traceId: "probe-1",
    });
    saveSession(adminSession);
    render(<AdminAccess><AdminAIConfig /></AdminAccess>);
    await screen.findByDisplayValue("model-a");

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByText(/本次真实探测通过/)).toBeInTheDocument();
    expect(screen.getByText(/不代表后续请求持续在线/)).toBeInTheDocument();
    expect(mocks.testAIConnection).toHaveBeenCalledOnce();
  });

  it("CSS module 对桌面、中屏和 390px 视口保持局部滚动而非页面溢出", () => {
    const css = readFileSync("src/components/admin-console.module.css", "utf8");
    expect(css).toContain("width: min(100%, 1500px)");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("@media (max-width: 1100px)");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("grid-template-columns: 1fr");
  });
});
