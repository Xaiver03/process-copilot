import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/charts", () => ({
  ProcessHeatmapChart: () => <div>热力图测试替身</div>,
  EvidenceTrendChart: () => null,
  ContributionChart: () => null,
}));

import { ReplayScreen } from "@/components/screens";

function streamResponse(chunks: string[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function streamMessage(type: string, runId: string, sequence: number, payload: Record<string, unknown>) {
  return `event: ${type}\ndata: ${JSON.stringify({
    type,
    sequence,
    runId,
    emittedAt: "2026-08-28T09:00:00.000Z",
    ...payload,
  })}\n\n`;
}

describe("回放控制", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("template 回放也会由本地时钟推进样本", async () => {
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    const run = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scenarioId: "wastewater-risk",
      state: "ready",
      speed: 10,
      currentSample: 0,
      createdAt: "2026-08-28T09:00:00+08:00",
      inferenceMode: "template",
      modelVersion: "uci-wtp-template-v1",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{
        id: "wastewater-risk",
        name: "污水出水风险场景",
        description: "污水出水风险预判",
        faultId: 0,
        sampleCount: 500,
        faultOnsetSample: 160,
        sourceLabel: "UCI Water Treatment Plant public sensor data",
        domain: "wastewater",
        modelFamily: "uci-wtp-rf-softsensor",
        sampleIntervalSeconds: 86400,
        recommendedInferenceMode: "template",
      }]))
      .mockResolvedValueOnce(response(run, 201))
      .mockResolvedValueOnce(response({ ...run, state: "playing" }))
      .mockResolvedValueOnce(response([{ id: "event-1", runId: run.id, sampleIndex: 160, severity: "warning", state: "open", anomalyScore: 0.8 }]));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ReplayScreen />);
    await screen.findByRole("option", { name: "污水出水风险预判" });
    await user.click(screen.getByRole("button", { name: "开始回放" }));
    const createCall = fetchMock.mock.calls.find(([url]) => url === "/api/v1/runs");
    expect(JSON.parse(String((createCall?.[1] as RequestInit).body))).toMatchObject({
      scenarioId: "wastewater-risk",
      inferenceMode: "template",
    });
    await waitFor(() => expect(screen.getByTestId("current-sample")).not.toHaveTextContent("0"), { timeout: 1200 });
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
      state: "ready",
      speed: 10,
      currentSample: 160,
      createdAt: "2026-08-28T09:00:00+08:00",
      inferenceMode: "online",
      modelVersion: "tep-online-v1",
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
      .mockResolvedValueOnce(response({ ...run, state: "playing" }))
      .mockResolvedValueOnce(streamResponse([streamMessage("state", run.id, 1, { state: "playing", sampleIndex: 160 })]))
      .mockResolvedValueOnce(response({ ...run, speed: 20 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplayScreen />);

    await screen.findByRole("option", { name: "A 进料中断（故障 6）" });
    expect(screen.getByRole("combobox", { name: "回放场景" }).closest("label")).toHaveClass("replay-scenario-field");
    expect(screen.getByRole("combobox", { name: "回放倍速" }).closest("label")).toHaveClass("replay-speed-field");
    await user.click(screen.getByRole("button", { name: "开始回放" }));
    expect(await screen.findByText("回放进行中")).toBeInTheDocument();
    expect(screen.getByText("在线 AI 推理样本通过实时事件流更新，不展示替代遥测。")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "回放倍速" }), "20");
    expect(await screen.findByRole("option", { name: "20×", selected: true })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[4] as [string, RequestInit];
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
      state: "ready",
      speed: 10,
      currentSample: 150,
      createdAt: "2026-08-28T09:00:00+08:00",
      inferenceMode: "online",
      modelVersion: "tep-online-v1",
    };
    const event = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      runId: run.id,
      sampleIndex: 170,
      severity: "critical",
      state: "open",
      anomalyScore: 0.91,
    };
    const inference = streamMessage("inference", run.id, 1, {
      sampleIndex: 175,
      inference: {
        runId: run.id,
        sampleIndex: 175,
        t2: 12.4,
        spe: 8.1,
        anomalyScore: 0.91,
        alarmState: "critical",
        modelVersion: "tep-online-v1",
        latencyMs: 4,
      },
    });
    const anomalyOpened = streamMessage("anomaly_opened", run.id, 2, {
      sampleIndex: 170,
      eventId: event.id,
    });
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
      .mockResolvedValueOnce(response({ ...run, state: "playing" }))
      .mockResolvedValueOnce(streamResponse([inference, anomalyOpened]))
      .mockResolvedValueOnce(response([event]))
      .mockResolvedValueOnce(response({ ...run, state: "paused" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReplayScreen />);
    await screen.findByRole("option", { name: "A 进料中断（故障 6）" });
    expect(screen.queryByText("A-feed loss")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始回放" }));

    await waitFor(() => expect(screen.getByTestId("current-sample")).toHaveTextContent("175"));
    expect(await screen.findByText(/样本 170 捕获严重偏移/)).toBeInTheDocument();

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
      state: "ready",
      speed: 20,
      currentSample: 958,
      createdAt: "2026-08-28T09:00:00+08:00",
      inferenceMode: "online",
      modelVersion: "tep-online-v1",
    };
    const completed = streamMessage("completed", run.id, 2, {
      state: "completed",
      sampleIndex: 960,
    });
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
      .mockResolvedValueOnce(response({ ...run, state: "playing" }))
      .mockResolvedValueOnce(streamResponse([completed])));

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
