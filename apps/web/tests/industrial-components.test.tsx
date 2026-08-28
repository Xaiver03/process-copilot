import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DataFreshness,
  EvidencePanel,
  HumanDecision,
  StatusTag,
} from "@/components/industrial";
import { demoEvent } from "@/lib/demo-data";

describe("工业状态组件", () => {
  it("用文字与图标共同表达偏移状态", () => {
    render(<StatusTag state="warning" label="过程偏移" />);

    expect(screen.getByText("过程偏移")).toBeInTheDocument();
    expect(screen.queryByLabelText("警告状态")).not.toBeInTheDocument();
    expect(screen.getByText("过程偏移").closest(".status-tag")?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("明确显示数据延迟和最后有效时间", () => {
    render(
      <DataFreshness
        state="delayed"
        lastUpdated="2026-08-28T08:31:00+08:00"
      />,
    );

    expect(screen.getByText("数据延迟")).toBeInTheDocument();
    expect(screen.getByText(/最后有效数据/)).toBeInTheDocument();
  });

  it("只渲染契约规定的三条对齐证据并提供屏幕阅读器摘要", () => {
    render(<EvidencePanel evidence={demoEvent.evidence} />);

    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("三项关键变量证据");
    expect(screen.getByRole("table", { name: "关键变量证据数据表" })).toBeInTheDocument();
  });

  it("人工确认要求操作者与说明，并提交结构化决策", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<HumanDecision onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByLabelText("研判结论"), "confirm");
    await user.type(screen.getByLabelText("操作者"), "王工");
    await user.type(screen.getByLabelText("研判说明"), "先检查冷却水入口温度与阀位反馈。 ");
    await user.click(screen.getByRole("button", { name: "确认并形成记录" }));

    expect(onSubmit).toHaveBeenCalledWith({
      decision: "confirm",
      operatorName: "王工",
      note: "先检查冷却水入口温度与阀位反馈。",
    });
  });
});
