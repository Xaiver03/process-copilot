import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("工业驾驶舱响应式样式契约", () => {
  it("将正文、辅助文字和触控目标固定为可读下限", () => {
    expect(css).toContain("--font-body: 16px");
    expect(css).toContain("--font-support: 14px");
    expect(css).toContain("--touch-target: 44px");
    expect(css).not.toMatch(/font-size:\s*(?:10|11|12|13)px/);
  });

  it("为四格系统状态提供四列、两列和单列断点", () => {
    expect(css).toMatch(/\.system-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
    expect(css).toMatch(/@media \(max-width:\s*1200px\)[\s\S]*?\.system-grid\s*\{[^}]*repeat\(2,/);
    expect(css).toMatch(/@media \(max-width:\s*700px\)[\s\S]*?\.system-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  });

  it("用网格约束 Replay 表单并在小屏启用表格滚动降级", () => {
    expect(css).toMatch(/\.replay-control\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.replay-scenario-field\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/@media \(max-width:\s*700px\)[\s\S]*?\.table-panel::before/);
  });

  it("为超宽屏限制可读行长但不回退到小窄栏", () => {
    expect(css).toMatch(/\.page-stack\s*\{[^}]*1680px/);
    expect(css).toMatch(/\.app-workspace main\s*\{[^}]*clamp\(/);
  });

  it("事件研判使用统一十二栏 AI 工作区并在平板收为单列", () => {
    expect(css).toMatch(/\.ai-workbench\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(12,/);
    expect(css).toMatch(/\.ai-stepper\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/@media \(max-width:\s*900px\)[\s\S]*?\.ai-workbench\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).not.toMatch(/\.event-detail-page[\s\S]*?\.investigation-grid/);
  });
});
