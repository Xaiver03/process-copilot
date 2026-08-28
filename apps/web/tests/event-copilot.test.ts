import { describe, expect, it } from "vitest";

import { demoEvent } from "@/lib/demo-data";
import { answerEventQuestion } from "@/lib/event-copilot";

describe("事件追问证据边界", () => {
  it("证据方向不一致时不捏造同向偏离", () => {
    const mixedDirectionEvent = {
      ...demoEvent,
      evidence: demoEvent.evidence.map((item, index) => ({
        ...item,
        direction: index === 1 ? "up" as const : "down" as const,
      })),
    };

    const answer = answerEventQuestion(mixedDirectionEvent, "为什么不是传感器故障？");
    expect(answer).toContain("证据不足以完全排除传感器故障");
    expect(answer).toContain("变化方向并不相同");
    expect(answer).not.toContain("同向偏离");
  });

  it("混合方向证据不会被误写成下降", () => {
    const mixedDirectionEvent = {
      ...demoEvent,
      evidence: demoEvent.evidence.map((item) => ({
        ...item,
        direction: "mixed" as const,
      })),
    };

    const answer = answerEventQuestion(mixedDirectionEvent, "为什么不是传感器故障？");
    expect(answer).toContain("波动方向混合");
    expect(answer).toContain("变化方向并不相同");
    expect(answer).not.toContain("均下降");
  });
});
