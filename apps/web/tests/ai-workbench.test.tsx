import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/charts", () => ({
  ContributionChart: () => <div>变量贡献图</div>,
  EvidenceTrendChart: () => <div>证据趋势图</div>,
  ProcessHeatmapChart: () => <div>过程热力图</div>,
}));

import { EventDetailScreen } from "@/components/screens";

describe("AI 可感知事件研判", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按发现、判断、解释、建议和人工确认呈现五步 AI 主链路", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { container } = render(<EventDetailScreen eventId="demo-event" />);

    expect(await screen.findByText("AI 研判结论")).toBeInTheDocument();
    expect(screen.getByText("AI 为什么这样判断")).toBeInTheDocument();
    expect(screen.getByText("AI 建议下一步")).toBeInTheDocument();
    expect(screen.getByText("人工确认点")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll("[data-ai-step]")).toHaveLength(5));
  });

  it("明确展示 AI 相对固定阈值规则多做的判断", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<EventDetailScreen eventId="demo-event" />);

    expect(await screen.findByText("不只报异常，还给出故障假设与变量证据")).toBeInTheDocument();
    expect(screen.getByText(/检测样本 160/)).toBeInTheDocument();
    expect(screen.getByText(/诊断样本 180/)).toBeInTheDocument();
  });
});
