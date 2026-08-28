import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiProblemError,
  getEventWithFallback,
  getRecordWithFallback,
  startOnlineScenarioWithFallback,
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
        state: "ready",
        speed: 10,
        currentSample: 0,
        createdAt: "2026-08-28T09:00:00+08:00",
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scenarioId: "tep-f06-a-feed-loss",
        state: "playing",
        speed: 10,
        currentSample: 0,
        createdAt: "2026-08-28T09:00:00+08:00",
      }))
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
    expect(journey.data.run.state).toBe("playing");
    expect(journey.data.event.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    const decision = await submitDecisionWithFallback(journey.data.event.id, {
      decision: "confirm",
      decisionMethod: "followed",
      note: "确认 A 料进料损失。",
    });
    expect(decision.mode).toBe("live");
    expect(decision.data.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/v1/runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/control");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({ action: "play", speed: 10 });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/api/v1/runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/events");
    expect(fetchMock.mock.calls[3]?.[0]).toContain("/api/v1/events/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/decision");
  });

  it("在线回放创建后立即播放并等待事件流，不提前读取事件列表", async () => {
    const run = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scenarioId: "tep-f06-a-feed-loss",
      state: "ready",
      speed: 10,
      currentSample: 0,
      createdAt: "2026-08-28T09:00:00+08:00",
      inferenceMode: "online",
      modelVersion: "tep-online-v1",
    };
    const playingRun = { ...run, state: "playing" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(run, 201))
      .mockResolvedValueOnce(jsonResponse(playingRun));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startOnlineScenarioWithFallback("tep-f06-a-feed-loss", 10);

    expect(result.mode).toBe("live");
    expect(result.data.run).toEqual(playingRun);
    expect(result.data.event).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      scenarioId: "tep-f06-a-feed-loss",
      inferenceMode: "online",
    });
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      action: "play",
      speed: 10,
    });
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

  it("明确的静态 Demo 深链接不请求在线 API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const event = await getEventWithFallback("demo-event");
    const record = await getRecordWithFallback("demo-record");

    expect(event.mode).toBe("static-demo");
    expect(record.mode).toBe("static-demo");
    expect(event.notice).toContain("静态 Demo");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("live run 已创建后控制请求断网会明确报错，不伪装成静态 Demo", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scenarioId: "tep-f06-a-feed-loss",
        state: "ready",
        speed: 10,
        currentSample: 0,
        createdAt: "2026-08-28T09:00:00+08:00",
      }, 201))
      .mockRejectedValueOnce(new TypeError("Failed to fetch")));

    await expect(startScenarioWithFallback("tep-f06-a-feed-loss", 10)).rejects.toThrow(
      "回放 aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa 已在服务器创建，但播放控制请求失败",
    );
  });

  it("live run 已播放后事件请求断网会明确报错，不混入静态事件", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scenarioId: "tep-f06-a-feed-loss",
        state: "ready",
        speed: 10,
        currentSample: 0,
        createdAt: "2026-08-28T09:00:00+08:00",
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scenarioId: "tep-f06-a-feed-loss",
        state: "playing",
        speed: 10,
        currentSample: 0,
        createdAt: "2026-08-28T09:00:00+08:00",
      }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch")));

    await expect(startScenarioWithFallback("tep-f06-a-feed-loss", 10)).rejects.toThrow(
      "回放 aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa 已进入播放态，但事件读取失败",
    );
  });

  it("终态 run 不会被重新发送 play", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scenarioId: "tep-f06-a-feed-loss",
      state: "completed",
      speed: 10,
      currentSample: 960,
      createdAt: "2026-08-28T09:00:00+08:00",
    }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startScenarioWithFallback("tep-f06-a-feed-loss", 10)).rejects.toThrow(
      "回放创建后已处于 completed，不能直接播放",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
