import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/charts", () => ({
  ContributionChart: () => <div>变量贡献图</div>,
  EvidenceTrendChart: () => <div>证据趋势图</div>,
  ProcessHeatmapChart: () => <div>过程热力图</div>,
}));

import { EventDetailScreen, OverviewScreen } from "@/components/screens";

describe("AI 可感知事件研判", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按发现、判断、解释、建议和人工确认呈现五步 AI 主链路", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { container } = render(<EventDetailScreen eventId="demo-event" />);

    expect(await screen.findByText("AI 研判结论")).toBeInTheDocument();
    expect(screen.getByText("原因")).toBeInTheDocument();
    expect(screen.getByText("AI 建议下一步")).toBeInTheDocument();
    expect(screen.getByText("人工确认点")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll("[data-ai-step]")).toHaveLength(5));
    expect(Array.from(container.querySelectorAll("[data-ai-step]"), (node) => node.getAttribute("data-ai-step"))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("明确展示 AI 相对固定阈值规则多做的判断", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<EventDetailScreen eventId="demo-event" />);

    expect(await screen.findByText("不只报异常，还给出故障假设与变量证据")).toBeInTheDocument();
    expect(screen.getByText(/检测样本 160/)).toBeInTheDocument();
    expect(screen.getByText(/诊断样本 180/)).toBeInTheDocument();
  });

  it("允许操作员自由追问，并在写回预演后明确显示未发送", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<EventDetailScreen eventId="demo-event" />);

    await screen.findByRole("heading", { name: "与序安协同研判" });
    await user.type(screen.getByRole("textbox", { name: "向序安追问" }), "为什么不是传感器故障？");
    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByText(/当前证据不足以完全排除传感器故障.*XMEAS\(21\).*XMV\(10\)/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预演写回" }));
    expect(await screen.findByText("草案已生成，未校验、未发送")).toBeInTheDocument();
    expect(screen.getByText(/当前 Demo 不连接 PLC\/DCS/)).toBeInTheDocument();
  });
});

describe("AI 装置总览", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("突出 AI 当前判断、优先原因和人工确认入口", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<OverviewScreen />);

    expect(await screen.findByText("AI 当前判断")).toBeInTheDocument();
    expect(screen.getByText("优先原因")).toBeInTheDocument();
    expect(screen.getByText("AI 异常分数")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看 AI 研判依据/ })).toBeInTheDocument();
  });
});
