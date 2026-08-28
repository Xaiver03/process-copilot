import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiProblemError,
  getEventWithFallback,
  startScenarioWithFallback,
  submitDecisionWithFallback,
} from "@/lib/api-client";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("真实 API 主链路与降级边界", () => {
  afterEach(() => vi.restoreAllMocks());

  it("使用后端返回的 run id、event id 和 record id 串起主链路", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scenarioId: "tep-f06-a-feed-loss",
        state: "playing",
        speed: 10,
        currentSample: 160,
        createdAt: "2026-08-28T09:00:00+08:00",
      }, 201))
      .mockResolvedValueOnce(jsonResponse([{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sampleIndex: 170,
        severity: "critical",
        state: "open",
        anomalyScore: 0.91,
      }]))
      .mockResolvedValueOnce(jsonResponse({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        decision: "confirm",
        operatorName: "王工",
        note: "确认 A 料进料损失。",
        createdAt: "2026-08-28T09:04:00+08:00",
        modelVersion: "model-live-1",
        traceId: "trace-live-1",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const journey = await startScenarioWithFallback("tep-f06-a-feed-loss", 10);
    expect(journey.mode).toBe("live");
    expect(journey.data.run.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(journey.data.event.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    const decision = await submitDecisionWithFallback(journey.data.event.id, {
      decision: "confirm",
      operatorName: "王工",
      note: "确认 A 料进料损失。",
    });
    expect(decision.mode).toBe("live");
    expect(decision.data.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/v1/runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/events");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/api/v1/events/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/decision");
  });

  it("HTTP 404 抛出 Problem，绝不回退为静态事件", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      code: "event_not_found",
      message: "事件不存在",
      traceId: "trace-404",
    }, 404)));

    await expect(getEventWithFallback("missing-event")).rejects.toMatchObject({
      name: "ApiProblemError",
      status: 404,
      code: "event_not_found",
      message: "事件不存在",
      traceId: "trace-404",
    } satisfies Partial<ApiProblemError>);
  });

  it("只有 fetch TypeError 才进入明确标注的静态 Demo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = await getEventWithFallback("any-event");
    expect(result.mode).toBe("static-demo");
    expect(result.notice).toContain("网络不可达");
  });

  it("普通异常不会触发静态降级", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("schema mismatch")));
    await expect(getEventWithFallback("any-event")).rejects.toThrow("schema mismatch");
  });
});
