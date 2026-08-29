import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventCopilot } from "@/components/event-copilot";
import { demoEvent } from "@/lib/demo-data";
import { saveSession } from "@/lib/auth-store";

const answer = {
  answer: "优先核对冷却水入口温度，再确认阀位反馈。",
  mode: "llm_enhanced" as const,
  model: "demo-model",
  evidenceRefs: ["XMEAS(21)", "XMV(10)"],
  latencyMs: 18,
  traceId: "trace-ask-001",
};

const controlProposal = {
  id: "99999999-9999-4999-8999-999999999999",
  eventId: demoEvent.id,
  actionDraft: "保持当前控制策略并提高关键变量监视频率",
  sourceTraceId: "trace-ask-001",
  executionMode: "shadow" as const,
  state: "blocked_demo_boundary" as const,
  checks: [
    { name: "人工提交", status: "passed" as const, detail: "已记录" },
    { name: "身份与角色", status: "passed" as const, detail: "仅影子评估" },
    { name: "工艺上下限", status: "not_configured" as const, detail: "未配置" },
    { name: "联锁与设备状态", status: "not_connected" as const, detail: "未连接" },
    { name: "控制网关", status: "disabled" as const, detail: "保持关闭" },
  ],
  requestedBy: "operator-01",
  sent: false as const,
  traceId: "trace-shadow-001",
  createdAt: "2026-08-29T00:00:00Z",
};

describe("事件协同研判在线 AI", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("登录后快捷问题携带当前 token 请求 ask API 并展示在线结果", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(answer), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    saveSession({
      token: "operator-secret-token",
      username: "operator-01",
      role: "operator",
      displayName: "中控操作员",
      expiresAt: "2099-01-01T00:00:00Z",
    });

    render(<EventCopilot event={demoEvent} />);
    await user.click(screen.getByRole("button", { name: "为什么不是传感器故障？" }));

    expect(await screen.findByText(answer.answer)).toBeInTheDocument();
    expect(screen.getByText("在线 AI")).toBeInTheDocument();
    expect(screen.getByText(/demo-model/)).toBeInTheDocument();
    expect(screen.getByText(/XMEAS\(21\).*XMV\(10\)/)).toBeInTheDocument();
    expect(screen.getByText(/trace-ask-001/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/events/${demoEvent.id}/ask`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer operator-secret-token",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      question: "为什么不是传感器故障？",
    });
  });

  it("未登录时保留本地确定性模板并明确提示先登录", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<EventCopilot event={demoEvent} />);
    await user.click(screen.getByRole("button", { name: "为什么不是传感器故障？" }));

    expect(await screen.findByText("本地模板")).toBeInTheDocument();
    expect(screen.getByText(/请先登录/)).toBeInTheDocument();
    expect(screen.getByText(/当前证据不足以完全排除传感器故障/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("在线请求显示 loading，输入框与快捷问题共用请求路径", async () => {
    const user = userEvent.setup();
    let resolveRequest: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    saveSession({
      token: "operator-token",
      username: "operator-01",
      role: "operator",
      displayName: "中控操作员",
      expiresAt: "2099-01-01T00:00:00Z",
    });

    render(<EventCopilot event={demoEvent} />);
    const input = screen.getByRole("textbox", { name: "向序安追问" });
    await user.type(input, "先确认什么？");
    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(screen.getByText("正在请求在线 AI…")).toBeInTheDocument();
    resolveRequest(new Response(JSON.stringify(answer), { status: 200 }));
    expect(await screen.findByText(answer.answer)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      question: "先确认什么？",
    });
  });

  it("在线失败不伪装成成功，并支持原问题重试", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    saveSession({
      token: "operator-token",
      username: "operator-01",
      role: "operator",
      displayName: "中控操作员",
      expiresAt: "2099-01-01T00:00:00Z",
    });

    render(<EventCopilot event={demoEvent} />);
    await user.click(screen.getByRole("button", { name: "为什么不是传感器故障？" }));
    expect(await screen.findByText("在线 AI 请求失败，请重试。")).toBeInTheDocument();
    expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText(answer.answer)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("网络请求失败时不把 token 渲染到事件协同面板", async () => {
    const user = userEvent.setup();
    const secret = "operator-token-never-rendered";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    saveSession({
      token: secret,
      username: "operator-01",
      role: "operator",
      displayName: "中控操作员",
      expiresAt: "2099-01-01T00:00:00Z",
    });

    render(<EventCopilot event={demoEvent} />);
    await user.click(screen.getByRole("button", { name: "为什么不是传感器故障？" }));
    await waitFor(() => expect(screen.getByText("在线 AI 请求失败，请重试。")).toBeInTheDocument());
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });

  it("把在线 AI 证据交给人工编辑后执行真实影子门禁并明确从未发送", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(controlProposal), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    saveSession({
      token: "operator-token",
      username: "operator-01",
      role: "operator",
      displayName: "中控操作员",
      expiresAt: "2099-01-01T00:00:00Z",
    });

    render(<EventCopilot event={demoEvent} />);
    await user.click(screen.getByRole("button", { name: "为什么不是传感器故障？" }));
    expect(await screen.findByText(answer.answer)).toBeInTheDocument();

    const draft = screen.getByRole("textbox", { name: "拟议处置动作" });
    await user.clear(draft);
    await user.type(draft, controlProposal.actionDraft);
    await user.click(screen.getByRole("button", { name: "运行影子门禁" }));

    expect(await screen.findByText("影子评估已记录，控制网关保持关闭")).toBeInTheDocument();
    expect(screen.getByText(/5 项门禁中 2 项通过，3 项阻断/)).toBeInTheDocument();
    expect(screen.getByText(/Trace：trace-shadow-001/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/v1/events/${demoEvent.id}/control-proposals`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer operator-token",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      actionDraft: controlProposal.actionDraft,
      sourceTraceId: "trace-ask-001",
    });
  });
});
