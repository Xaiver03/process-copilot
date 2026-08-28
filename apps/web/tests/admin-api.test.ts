import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdminOverview,
  listAdminAudit,
  updateAIConfig,
} from "@/lib/admin-api";
import { saveSession } from "@/lib/auth-store";

const adminSession = {
  token: "admin-token",
  username: "system-admin",
  role: "admin" as const,
  displayName: "系统管理员",
  expiresAt: "2099-01-01T00:00:00Z",
};

describe("admin API client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    saveSession(adminSession);
    vi.restoreAllMocks();
  });

  it("携带当前管理员令牌读取概览", async () => {
    const payload = { inferenceMode: "online", recentLLMCalls: [], degradedReasons: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminOverview()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/overview", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer admin-token" }),
    }));
  });

  it("密钥留空时不发送 apiKey，显式清除时发送 clearApiKey", async () => {
    const config = {
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "model-a",
      enabled: true,
      timeoutMs: 12000,
      maxTokens: 800,
      temperature: 0.2,
      promptVersion: "v1",
      fallbackPolicy: "template" as const,
      apiKeyConfigured: true,
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(config), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await updateAIConfig({ ...config, apiKey: "   ", clearApiKey: false });
    const preserveBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(preserveBody).not.toHaveProperty("apiKey");
    expect(preserveBody).toMatchObject({ clearApiKey: false });

    await updateAIConfig({ ...config, apiKey: "", clearApiKey: true });
    const clearBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(clearBody).not.toHaveProperty("apiKey");
    expect(clearBody).toMatchObject({ clearApiKey: true });
  });

  it("非管理员在发出请求前即被拒绝", async () => {
    saveSession({ ...adminSession, username: "operator-01", role: "operator" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminOverview()).rejects.toThrow("仅系统管理员");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("保留 Problem 错误信息且审计分页使用契约查询参数", async () => {
    const problem = { code: "forbidden", message: "管理员权限不足", traceId: "trace-403" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(problem), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminOverview()).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      traceId: "trace-403",
      message: "管理员权限不足",
    });
    await listAdminAudit({ limit: 20, offset: 40 });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/audit?limit=20&offset=40");
  });
});
