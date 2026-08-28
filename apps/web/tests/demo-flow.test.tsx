import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoJourney } from "@/components/demo-journey";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("Demo 主链路", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("在线模式选择正式场景并使用真实 event id 进入研判", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: "tep-f13-kinetics-drift",
        name: "动力学缓慢漂移",
        description: "正式演示场景",
        faultId: 13,
        sampleCount: 500,
        faultOnsetSample: 160,
        sourceLabel: "Tennessee Eastman Process public simulation",
      }]))
      .mockResolvedValueOnce(jsonResponse({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scenarioId: "tep-f13-kinetics-drift",
        state: "playing",
        speed: 10,
        currentSample: 160,
        createdAt: "2026-08-28T09:00:00+08:00",
      }, 201))
      .mockResolvedValueOnce(jsonResponse([{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sampleIndex: 171,
        severity: "warning",
        state: "open",
        anomalyScore: 0.73,
      }])));
    render(<DemoJourney />);

    await screen.findByRole("option", { name: "动力学缓慢漂移" });
    await user.click(screen.getByRole("button", { name: "创建回放并读取事件" }));
    expect(await screen.findByRole("link", { name: "进入真实事件研判" })).toHaveAttribute(
      "href", "/events/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
  });

  it("网络不可达时才显示静态 Demo ID", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<DemoJourney />);

    await screen.findByText("静态 Demo 降级");
    await user.click(screen.getByRole("button", { name: "创建回放并读取事件" }));
    expect(await screen.findByRole("link", { name: "进入静态事件研判" })).toHaveAttribute("href", "/events/demo-event");
  });
});
