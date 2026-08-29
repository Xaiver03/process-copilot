import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const publicAsset = (name: string) => resolve(process.cwd(), "public", name);

describe("浏览器品牌资产", () => {
  it("提供浏览器通用 favicon.ico", () => {
    const bytes = readFileSync(publicAsset("favicon.ico"));
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 0, 1, 0]);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("提供 App Router 高分辨率 icon.png", () => {
    const bytes = readFileSync(publicAsset("icon.png"));
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("站点元数据显式引用标准浏览器图标", () => {
    const layoutSource = readFileSync(resolve(process.cwd(), "src", "app", "layout.tsx"), "utf8");
    expect(layoutSource).toContain('title: "序安·磷煤化工异常早期预警平台"');
    expect(layoutSource).toContain('icon: "/favicon.ico"');
    expect(layoutSource).toContain('apple: "/icon.png"');
  });
});
