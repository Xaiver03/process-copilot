import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getEnvironmentalScenarioDetail,
  getEnvironmentalScenariosWithFallback,
  simulateCapacityPlan,
} from "@/lib/api-client";

describe("Xifeng park alignment API client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("在线时返回环境场景列表并标注 live 模式", async () => {
    const payload = [
      {
        id: "xifeng-jiaoyishan-leachate",
        name: "交椅山磷石膏渣库渗滤液早期预警（示意）",
        sourceLabel: "Synthetic illustrative scenario derived from public Xifeng park EIA and regulatory disclosures; not real sensor data.",
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));

    const result = await getEnvironmentalScenariosWithFallback();
    expect(result.mode).toBe("live");
    expect(result.data).toEqual(payload);
  });

  it("网络不可达时环境场景列表降级为空数组，不编造场景", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unreachable")));

    const result = await getEnvironmentalScenariosWithFallback();
    expect(result.mode).toBe("static-demo");
    expect(result.data).toEqual([]);
  });

  it("按场景 id 请求环境场景详情", async () => {
    const detail = { scenario: { id: "xifeng-jiaoyishan-leachate" }, dayIndex: [0, 1], series: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEnvironmentalScenarioDetail("xifeng-jiaoyishan-leachate")).resolves.toEqual(detail);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/environmental-scenarios/xifeng-jiaoyishan-leachate",
      expect.anything(),
    );
  });

  it("提交产能仿真请求并透传请求体", async () => {
    const response = { gypsumCapTpd: 1000, options: [], disclosure: "illustrative" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = {
      gypsumCapTpd: 1000,
      gypsumRatioLow: 4.0,
      gypsumRatioHigh: 5.0,
      lines: [{ id: "fertilizer", name: "磷肥支路", requestedP2o5Tpd: 100, priority: 0 }],
    };
    await expect(simulateCapacityPlan(request)).resolves.toEqual(response);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/v1/capacity-plan/simulate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(request);
  });
});
