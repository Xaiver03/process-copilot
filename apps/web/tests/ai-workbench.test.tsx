import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/charts", () => ({
  ContributionChart: () => <div>变量贡献图</div>,
  EvidenceTrendChart: () => <div>证据趋势图</div>,
  ProcessHeatmapChart: () => <div>过程热力图</div>,
}));

import { EventDetailScreen, OverviewScreen } from "@/components/screens";
import { demoEvent } from "@/lib/demo-data";

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
    await waitFor(() => {
      expect(container.querySelectorAll("[data-ai-step]").length).toBe(5);
    });
    expect(Array.from(container.querySelectorAll("[data-ai-step]"), (node) => node.getAttribute("data-ai-step"))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("步骤导航可点击跳转到锚点，且当前步骤带 aria-current", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<EventDetailScreen eventId="demo-event" />);

    await screen.findByRole("heading", { name: "风险何时被看见" });
    const ids = [
      "step-01-detection",
      "step-02-conclusion",
      "step-03-explanation",
      "step-04-recommendation",
      "step-05-decision",
    ];
    for (const id of ids) {
      expect(container.querySelector(`#${id}`)).toBeInTheDocument();
    }

    const detectLink = container.querySelector('a[href="#step-01-detection"]');
    const explainLink = container.querySelector('a[href="#step-03-explanation"]');
    const decisionLink = container.querySelector('a[href="#step-05-decision"]');
    expect(detectLink).toBeInstanceOf(HTMLAnchorElement);
    expect(explainLink).toBeInstanceOf(HTMLAnchorElement);
    expect(decisionLink).toBeInstanceOf(HTMLAnchorElement);
    expect(detectLink).toHaveAttribute("aria-current", "step");

    await user.click(explainLink as HTMLElement);
    expect(explainLink).toHaveAttribute("aria-current", "step");
    expect(container.querySelector("#step-03-explanation")).toHaveFocus();

    await user.click(decisionLink as HTMLElement);
    expect(decisionLink).toHaveAttribute("aria-current", "step");
    expect(container.querySelector("#step-05-decision")).toHaveFocus();
  });

  it("默认场景明确展示预测值、历史边界和不确定区间", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<EventDetailScreen eventId="demo-event" />);

    expect(await screen.findByText("提前预测出水风险，并给出边界与不确定区间")).toBeInTheDocument();
    expect(screen.getByText(/预测输入样本 42/)).toBeInTheDocument();
    expect(screen.getByText("历史高位边界")).toBeInTheDocument();
    expect(screen.getByText(/训练段 DQO-S P95，不是法律排放限值/)).toBeInTheDocument();
  });

  it("保留连续化工 TEP 场景的偏移发现、候选排序和变量证据", async () => {
    const tepEvent = {
      ...demoEvent,
      prediction: undefined,
      detectionSample: 160,
      diagnosisSample: 180,
      diagnosisDelaySamples: 20,
      candidates: [{ faultId: 6, label: "A feed loss", probability: 1 }],
      initialCandidates: [{ faultId: 6, label: "A feed loss", probability: 1 }],
      evidence: [
        { variableId: "XMEAS(1)", variableName: "A 进料", unit: "kscmh", contribution: 0.5, direction: "down", summary: "A 进料下降", values: [1, 0.8] },
        { variableId: "XMV(3)", variableName: "A 进料阀", unit: "%", contribution: 0.3, direction: "up", summary: "阀位补偿", values: [40, 60] },
        { variableId: "XMEAS(20)", variableName: "压缩机功率", unit: "kW", contribution: 0.2, direction: "mixed", summary: "负荷波动", values: [100, 98] },
      ],
      modelVersion: "tep-pca-classifier-demo-0.1",
      dataSourceDisclosure: "Public Tennessee Eastman Process simulation data.",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tepEvent), { status: 200 })));

    render(<EventDetailScreen eventId="tep-event" />);

    expect(await screen.findByRole("heading", { name: "偏移何时被看见" })).toBeInTheDocument();
    expect(screen.getByText("不只报异常，还给出故障假设与变量证据")).toBeInTheDocument();
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
    expect(await screen.findByText(/当前证据不足以完全排除传感器故障.*PH-P.*PH-E.*Q-E/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预演写回" }));
    expect(await screen.findByText("草案已生成，未校验、未发送")).toBeInTheDocument();
    expect(screen.getByText(/当前 Demo 不连接 PLC\/DCS/)).toBeInTheDocument();
  });
});

describe("AI 装置总览", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("总览使用运营仪表盘而非回放趋势图，并提供开始回放动作", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { container } = render(<OverviewScreen />);

    expect(await screen.findByText("风险队列")).toBeInTheDocument();
    expect(screen.getByText("场景覆盖")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /开始 WTP 回放/ })).toHaveAttribute("href", "/replay");
    expect(screen.queryByText("证据趋势图")).not.toBeInTheDocument();
    expect(container.querySelector(".evidence-chart")).not.toBeInTheDocument();
  });

  it("保留预测摘要和人工确认入口", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<OverviewScreen />);

    expect(await screen.findByText("下一周期预测")).toBeInTheDocument();
    expect(screen.getByText("不确定区间")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看 AI 研判依据/ })).toBeInTheDocument();
  });

  it("在线总览的研判入口进入现有回放，而不是创建新的演示", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: "wastewater-risk",
      name: "污水出水风险场景",
      description: "污水出水风险预判",
      faultId: 0,
      sampleCount: 101,
      faultOnsetSample: 42,
      sourceLabel: "UCI Water Treatment Plant public sensor data",
      domain: "wastewater",
      modelFamily: "uci-wtp-rf-softsensor",
      sampleIntervalSeconds: 86400,
      recommendedInferenceMode: "template",
    }]), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<OverviewScreen />);

    expect(await screen.findByRole("link", { name: /查看 AI 研判依据/ })).toHaveAttribute("href", "/replay");
  });
});
