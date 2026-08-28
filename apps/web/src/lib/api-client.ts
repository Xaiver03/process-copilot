import type { components } from "./api-schema";
import { demoEvent, demoEvents, demoRecord, demoRun, demoScenario } from "./demo-data";
import { readSession, saveSession, clearSession, type AuthSession } from "./auth-store";

type EventDetail = components["schemas"]["EventDetail"];
type DecisionRecord = components["schemas"]["DecisionRecord"];
type Scenario = components["schemas"]["Scenario"];
type DecisionRequest = components["schemas"]["DecisionRequest"];
type ReplayRun = components["schemas"]["ReplayRun"];
type CreateRunRequest = components["schemas"]["CreateRunRequest"];
type RunControlRequest = components["schemas"]["RunControlRequest"];
type AnomalyEvent = components["schemas"]["AnomalyEvent"];
type Health = components["schemas"]["Health"];
type Problem = components["schemas"]["Problem"];
type LoginRequest = components["schemas"]["LoginRequest"];

export type DataMode = "live" | "static-demo";

export interface ApiResult<T> {
  data: T;
  mode: DataMode;
  notice: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiProblemError extends Error {
  readonly name = "ApiProblemError";

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

class NetworkUnavailableError extends Error {
  readonly name = "NetworkUnavailableError";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const session = readSession();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) throw new NetworkUnavailableError(error.message);
    throw error;
  }
  if (!response.ok) {
    let problem: Partial<Problem> = {};
    try {
      problem = await response.json() as Partial<Problem>;
    } catch {
      // Non-JSON upstream errors still remain explicit HTTP failures.
    }
    throw new ApiProblemError(
      response.status,
      problem.code ?? `http_${response.status}`,
      problem.message ?? `API 请求失败（${response.status}）`,
      problem.traceId ?? response.headers.get("x-trace-id") ?? "unknown",
      problem.details,
    );
  }
  return (await response.json()) as T;
}

async function withFallback<T>(request: () => Promise<T>, fallback: T): Promise<ApiResult<T>> {
  try {
    return {
      data: await request(),
      mode: "live",
      notice: "已连接只读演示 API",
    };
  } catch (error) {
    if (!(error instanceof NetworkUnavailableError)) throw error;
    return {
      data: fallback,
      mode: "static-demo",
      notice: "网络不可达，当前为明确标注的静态 Demo 数据，确认操作不会写入服务器。",
    };
  }
}

export async function login(payload: LoginRequest): Promise<AuthSession> {
  const data = await requestJson<components["schemas"]["LoginResponse"]>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const session: AuthSession = {
    token: data.token,
    username: data.username,
    role: data.role,
    displayName: data.displayName,
    expiresAt: data.expiresAt,
  };
  saveSession(session);
  return session;
}

export function getScenariosWithFallback(): Promise<ApiResult<Scenario[]>> {
  return withFallback(() => requestJson<Scenario[]>("/api/v1/scenarios"), [demoScenario]);
}

export function getEventWithFallback(eventId: string): Promise<ApiResult<EventDetail>> {
  return withFallback(() => requestJson<EventDetail>(`/api/v1/events/${eventId}`), demoEvent);
}

export function createRunWithFallback(payload: CreateRunRequest): Promise<ApiResult<ReplayRun>> {
  return withFallback(
    () => requestJson<ReplayRun>("/api/v1/runs", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    }),
    { ...demoRun, scenarioId: payload.scenarioId, speed: payload.speed ?? 10, state: "playing" },
  );
}

export function controlRunWithFallback(runId: string, payload: RunControlRequest): Promise<ApiResult<ReplayRun>> {
  return withFallback(
    () => requestJson<ReplayRun>(`/api/v1/runs/${runId}/control`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    }),
    {
      ...demoRun,
      state: payload.action === "play" ? "playing" : payload.action === "pause" ? "paused" : demoRun.state,
      speed: payload.speed ?? demoRun.speed,
      currentSample: payload.sampleIndex ?? (payload.action === "restart" ? 0 : demoRun.currentSample),
    },
  );
}

export function listRunEventsWithFallback(runId: string): Promise<ApiResult<AnomalyEvent[]>> {
  return withFallback(() => requestJson<AnomalyEvent[]>(`/api/v1/runs/${runId}/events`), demoEvents);
}

export function getReadinessWithFallback(): Promise<ApiResult<Health>> {
  return withFallback(() => requestJson<Health>("/readyz"), {
    status: "degraded",
    checks: { api: "offline", demo: "static fallback ready" },
  });
}

export function getRecordWithFallback(recordId: string): Promise<ApiResult<DecisionRecord>> {
  return withFallback(() => requestJson<DecisionRecord>(`/api/v1/records/${recordId}`), demoRecord);
}

export async function submitDecisionWithFallback(
  eventId: string,
  decision: DecisionRequest,
): Promise<ApiResult<DecisionRecord>> {
  return withFallback(
    () =>
      requestJson<DecisionRecord>(`/api/v1/events/${eventId}/decision`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(decision),
      }).catch((error: unknown) => {
        if (error instanceof ApiProblemError && error.status === 401) clearSession();
        throw error;
      }),
    { ...demoRecord, ...decision },
  );
}

export async function startScenarioWithFallback(
  scenarioId: string,
  speed: NonNullable<CreateRunRequest["speed"]> = 10,
): Promise<ApiResult<{ run: ReplayRun; event: AnomalyEvent }>> {
  const runResult = await createRunWithFallback({ scenarioId, speed });
  if (runResult.mode === "static-demo") {
    return {
      data: { run: runResult.data, event: demoEvent },
      mode: runResult.mode,
      notice: runResult.notice,
    };
  }

  const eventsResult = await listRunEventsWithFallback(runResult.data.id);
  const event = eventsResult.data[0];
  if (!event) throw new Error("回放已创建，但尚未生成可研判事件，请重试。");
  return {
    data: { run: runResult.data, event },
    mode: eventsResult.mode,
    notice: eventsResult.notice,
  };
}
