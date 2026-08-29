import type { components } from "./api-schema";
import { readSession } from "./auth-store";

type AIAnswer = components["schemas"]["AIAnswer"];
type ControlProposal = components["schemas"]["ControlProposal"];
type Problem = components["schemas"]["Problem"];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class EventAIClientError extends Error {
  readonly name = "EventAIClientError";

  constructor(
    message: string,
    readonly status: number,
    readonly traceId?: string,
  ) {
    super(message);
  }
}

export async function askEventQuestion(eventId: string, question: string): Promise<AIAnswer> {
  const session = readSession();
  if (!session) {
    throw new EventAIClientError("请先登录后使用在线 AI。", 401);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/events/${eventId}/ask`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ question }),
    });
  } catch {
    throw new EventAIClientError("在线 AI 请求失败，请重试。", 0);
  }

  if (!response.ok) {
    let problem: Partial<Problem> = {};
    try {
      problem = (await response.json()) as Partial<Problem>;
    } catch {
      // Keep provider and transport details out of the user-facing error.
    }
    throw new EventAIClientError(
      response.status === 401 ? "请先登录后使用在线 AI。" : "在线 AI 请求失败，请重试。",
      response.status,
      problem.traceId,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EventAIClientError("在线 AI 请求失败，请重试。", response.status);
  }
  if (!isAIAnswer(payload)) {
    throw new EventAIClientError("在线 AI 返回格式无效，请重试。", response.status);
  }
  return payload;
}

export async function createControlProposal(
  eventId: string,
  actionDraft: string,
  sourceTraceId?: string,
): Promise<ControlProposal> {
  const session = readSession();
  if (!session) {
    throw new EventAIClientError("请先登录后运行影子门禁。", 401);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/events/${eventId}/control-proposals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
        "Idempotency-Key": `shadow-${eventId}-${Date.now()}`,
      },
      body: JSON.stringify({
        actionDraft,
        ...(sourceTraceId ? { sourceTraceId } : {}),
      }),
    });
  } catch {
    throw new EventAIClientError("影子门禁请求失败，请重试。", 0);
  }

  if (!response.ok) {
    let problem: Partial<Problem> = {};
    try {
      problem = (await response.json()) as Partial<Problem>;
    } catch {
      // Keep server and provider details out of the user-facing error.
    }
    const message = response.status === 422
      ? "草案包含可执行控制坐标，请改为人工检查或处置意图。"
      : response.status === 401
        ? "请先登录后运行影子门禁。"
        : "影子门禁请求失败，请重试。";
    throw new EventAIClientError(message, response.status, problem.traceId);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EventAIClientError("影子门禁返回格式无效，请重试。", response.status);
  }
  if (!isControlProposal(payload)) {
    throw new EventAIClientError("影子门禁返回格式无效，请重试。", response.status);
  }
  return payload;
}

function isAIAnswer(payload: unknown): payload is AIAnswer {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<AIAnswer>;
  return (
    typeof candidate.answer === "string" &&
    (candidate.mode === "llm_enhanced" || candidate.mode === "template" || candidate.mode === "degraded") &&
    typeof candidate.model === "string" &&
    Array.isArray(candidate.evidenceRefs) &&
    candidate.evidenceRefs.every((ref) => typeof ref === "string") &&
    typeof candidate.latencyMs === "number" &&
    typeof candidate.traceId === "string"
  );
}

function isControlProposal(payload: unknown): payload is ControlProposal {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<ControlProposal>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.eventId === "string" &&
    typeof candidate.actionDraft === "string" &&
    candidate.executionMode === "shadow" &&
    candidate.state === "blocked_demo_boundary" &&
    Array.isArray(candidate.checks) &&
    candidate.checks.every((check) =>
      typeof check.name === "string" &&
      typeof check.detail === "string" &&
      ["passed", "not_configured", "not_connected", "disabled"].includes(check.status)
    ) &&
    candidate.sent === false &&
    typeof candidate.traceId === "string"
  );
}
