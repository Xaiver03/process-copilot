import type { components } from "./api-schema";
import { isAdmin, readSession } from "./auth-store";

export type AdminOverview = components["schemas"]["AdminOverview"];
export type AIStatus = components["schemas"]["AIStatus"];
export type AIConfig = components["schemas"]["AIConfig"];
export type AIConnectionTestResponse = components["schemas"]["AIConnectionTestResponse"];
export type AIInteractionPage = components["schemas"]["AIInteractionPage"];
export type AdminAuditPage = components["schemas"]["AdminAuditPage"];

type Problem = components["schemas"]["Problem"];
type UpdateAIConfigRequest = components["schemas"]["UpdateAIConfigRequest"];
type AIConnectionTestRequest = components["schemas"]["AIConnectionTestRequest"];

export type AdminAIConfigDraft = Omit<AIConfig, "apiKeyConfigured"> & {
  apiKey: string;
  clearApiKey: boolean;
};

export interface PageQuery {
  limit?: number;
  offset?: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class AdminApiProblemError extends Error {
  readonly name = "AdminApiProblemError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function getAdminToken(): string {
  const session = readSession();
  if (!session) throw new Error("请先登录系统管理员账号。");
  if (!isAdmin(session)) throw new Error("仅系统管理员可访问此功能。");
  return session.token;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAdminToken()}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let problem: Partial<Problem> = {};
    try {
      problem = await response.json() as Partial<Problem>;
    } catch {
      // Keep an explicit HTTP failure if an upstream proxy returns non-JSON.
    }
    throw new AdminApiProblemError(
      response.status,
      problem.code ?? `http_${response.status}`,
      problem.message ?? `管理 API 请求失败（${response.status}）`,
      problem.traceId ?? response.headers.get("x-trace-id") ?? "unknown",
      problem.details,
    );
  }
  return (await response.json()) as T;
}

function pageQuery(query: PageQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function getAdminOverview(): Promise<AdminOverview> {
  return requestJson("/api/v1/admin/overview");
}

export function getAIStatus(): Promise<AIStatus> {
  return requestJson("/api/v1/admin/ai/status");
}

export function getAIConfig(): Promise<AIConfig> {
  return requestJson("/api/v1/admin/ai/config");
}

export function updateAIConfig(draft: AdminAIConfigDraft): Promise<AIConfig> {
  const { apiKey, clearApiKey, ...config } = draft;
  const body: UpdateAIConfigRequest = {
    ...config,
    clearApiKey,
    ...(apiKey.trim() && !clearApiKey ? { apiKey: apiKey.trim() } : {}),
  };
  return requestJson("/api/v1/admin/ai/config", {
    method: "PUT",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

export function testAIConnection(payload: AIConnectionTestRequest = {}): Promise<AIConnectionTestResponse> {
  return requestJson("/api/v1/admin/ai/test", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

export function listAIInteractions(query: PageQuery = {}): Promise<AIInteractionPage> {
  return requestJson(`/api/v1/admin/ai/interactions${pageQuery(query)}`);
}

export function listAdminAudit(query: PageQuery = {}): Promise<AdminAuditPage> {
  return requestJson(`/api/v1/admin/audit${pageQuery(query)}`);
}
