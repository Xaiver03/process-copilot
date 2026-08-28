import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/charts", () => ({
  ProcessHeatmapChart: () => <div>热力图测试替身</div>,
  EvidenceTrendChart: () => null,
  ContributionChart: () => null,
}));

import { ReplayScreen } from "@/components/screens";

describe("回放控制", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("在线回放的倍速选择会调用 control API", async () => {
    const user = userEvent.setup();
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    const run = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scenarioId: "tep-f06-a-feed-loss",
      state: "playing",
      speed: 10,
      currentSample: 160,
      createdAt: "2026-08-28T09:00:00+08:00",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{
        id: "tep-f06-a-feed-loss",
        name: "A 料进料损失",
        description: "正式演示场景",
        faultId: 6,
        sampleCount: 500,
        faultOnsetSample: 160,
        sourceLabel: "Tennessee Eastman Process public simulation",
      }]))
      .mockResolvedValueOnce(response(run, 201))
      .mockResolvedValueOnce(response([{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        runId: run.id,
        sampleIndex: 170,
        severity: "critical",
        state: "open",
        anomalyScore: 0.91,
      }]))
      .mockResolvedValueOnce(response({ ...run, speed: 20 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplayScreen />);

    await screen.findByRole("option", { name: "A 进料中断（故障 6）" });
    expect(screen.getByRole("combobox", { name: "回放场景" }).closest("label")).toHaveClass("replay-scenario-field");
    expect(screen.getByRole("combobox", { name: "回放倍速" }).closest("label")).toHaveClass("replay-speed-field");
    await user.click(screen.getByRole("button", { name: "开始回放" }));
    expect(await screen.findByText("回放进行中")).toBeInTheDocument();
    expect(screen.getByText("XMEAS(1)")).toBeInTheDocument();
    expect(screen.queryByText("XMEAS(21)")).not.toBeInTheDocument();
    expect(screen.getByText("场景仿真变量 · 非现场实时遥测")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "回放倍速" }), "20");
    expect(await screen.findByRole("option", { name: "20×", selected: true })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url).toContain(`/api/v1/runs/${run.id}/control`);
    expect(JSON.parse(String(init.body))).toMatchObject({ action: "play", speed: 20 });
  });

  it("播放后推进样本、到达事件样本才显示异常，暂停后停止推进", async () => {
    const user = userEvent.setup();
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    const run = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scenarioId: "tep-f06-a-feed-loss",
      state: "playing",
      speed: 10,
      currentSample: 150,
      createdAt: "2026-08-28T09:00:00+08:00",
    };
    const event = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      runId: run.id,
      sampleIndex: 170,
      severity: "critical",
      state: "open",
      anomalyScore: 0.91,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{
        id: "tep-f06-a-feed-loss",
        name: "A-feed loss",
        description: "TEP scenario",
        faultId: 6,
        sampleCount: 500,
        faultOnsetSample: 160,
        sourceLabel: "Tennessee Eastman Process public simulation",
      }]))
      .mockResolvedValueOnce(response(run, 201))
      .mockResolvedValueOnce(response([event]))
      .mockResolvedValueOnce(response({ ...run, state: "paused" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReplayScreen />);
    await screen.findByRole("option", { name: "A 进料中断（故障 6）" });
    expect(screen.queryByText("A-feed loss")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始回放" }));

    expect(await screen.findByTestId("current-sample")).toHaveTextContent("150");
    expect(screen.queryByText(/样本 170 捕获严重偏移/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("current-sample")).not.toHaveTextContent("150"), { timeout: 1400 });
    await waitFor(() => expect(screen.getByText(/样本 170 捕获严重偏移/)).toBeInTheDocument(), { timeout: 1800 });

    await user.click(screen.getByRole("button", { name: "暂停回放" }));
    const pausedSample = screen.getByTestId("current-sample").textContent;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByTestId("current-sample")).toHaveTextContent(pausedSample ?? "");
  });

  it("使用场景样本总数并在末尾停止回放", async () => {
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    const run = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scenarioId: "tep-f06-a-feed-loss",
      state: "playing",
      speed: 20,
      currentSample: 958,
      createdAt: "2026-08-28T09:00:00+08:00",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response([{
        id: "tep-f06-a-feed-loss",
        name: "A-feed loss",
        description: "TEP scenario",
        faultId: 6,
        sampleCount: 960,
        faultOnsetSample: 160,
        sourceLabel: "Tennessee Eastman Process public simulation",
      }]))
      .mockResolvedValueOnce(response(run, 201))
      .mockResolvedValueOnce(response([{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        runId: run.id,
        sampleIndex: 170,
        severity: "critical",
        state: "open",
        anomalyScore: 0.91,
      }])));

    const user = userEvent.setup();
    render(<ReplayScreen />);
    await screen.findByRole("option", { name: "A 进料中断（故障 6）" });
    await user.click(screen.getByRole("button", { name: "开始回放" }));

    expect(await screen.findByText("/ 960")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("current-sample")).toHaveTextContent("960"), { timeout: 1200 });
    expect(screen.getByText("回放已完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂停回放" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "回放倍速" })).toBeDisabled();
  });
});
