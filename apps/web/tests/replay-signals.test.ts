import { describe, expect, it } from "vitest";

import { getReplaySignalDefinitions } from "@/lib/replay-demo";

describe("回放变量配置", () => {
  it("使用变量字典中的 F06 中文名称", () => {
    expect(getReplaySignalDefinitions(6)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "XMV(3)", name: "A 进料流量（物流 1）" }),
    ]));
  });

  it("未知故障不冒充冷却水场景", () => {
    expect(getReplaySignalDefinitions(21)).toEqual([]);
  });
});
