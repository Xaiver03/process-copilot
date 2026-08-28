import { describe, expect, it } from "vitest";
import path from "node:path";

import nextConfig from "../next.config";
import { GET } from "@/app/healthz/route";

describe("容器集成", () => {
  it("生成 standalone 运行产物", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.outputFileTracingRoot).toBe(path.resolve(process.cwd(), "../.."));
  });

  it("healthz 返回可用于容器健康检查的 JSON", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "process-copilot-web" });
  });
});
