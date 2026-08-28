import type { components } from "./api-schema";
import { readSession } from "./auth-store";

export type RunStreamMessage = components["schemas"]["SSEMessage"];
export type RunStreamEventType = RunStreamMessage["type"];

export interface RunStreamHandlers {
  onMessage?: (message: RunStreamMessage) => void;
  onEvent?: (message: RunStreamMessage) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onState?: (message: RunStreamMessage) => void;
  onInference?: (message: RunStreamMessage) => void;
  onAnomalyOpened?: (message: RunStreamMessage) => void;
  onDiagnosisUpdated?: (message: RunStreamMessage) => void;
  onCompleted?: (message: RunStreamMessage) => void;
  onFailed?: (message: RunStreamMessage) => void;
  onHeartbeat?: (message: RunStreamMessage) => void;
}

export interface RunStreamOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  initialLastEventId?: string;
  maxRetryDelayMs?: number;
  retryBaseDelayMs?: number;
  signal?: AbortSignal;
}

const EVENT_TYPES: readonly RunStreamEventType[] = [
  "state",
  "inference",
  "anomaly_opened",
  "diagnosis_updated",
  "completed",
  "failed",
  "heartbeat",
];
const RUN_STATES = ["ready", "playing", "paused", "completed", "failed"] as const;
const ALARM_STATES = ["normal", "warning", "critical"] as const;
const DIAGNOSIS_STATES = ["pending", "provisional", "updated"] as const;

class RunStreamProtocolError extends Error {
  readonly name = "RunStreamProtocolError";
}

class RunStreamHttpError extends Error {
  readonly name = "RunStreamHttpError";

  constructor(readonly status: number) {
    super(`回放事件流请求失败（${status}）`);
  }
}

interface SseFrame {
  data: string[];
  event?: string;
  id?: string;
}

type StreamReader = ReadableStreamDefaultReader<Uint8Array>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function validateInference(value: unknown, runId: string): void {
  if (!isRecord(value)
    || value.runId !== runId
    || !isNonNegativeInteger(value.sampleIndex)
    || !isFiniteNumber(value.t2)
    || !isFiniteNumber(value.spe)
    || !isFiniteNumber(value.anomalyScore)
    || !isOneOf(value.alarmState, ALARM_STATES)
    || typeof value.modelVersion !== "string"
    || !isFiniteNumber(value.latencyMs)
    || value.latencyMs < 0) {
    throw new RunStreamProtocolError("回放事件流包含非法 inference payload");
  }
}

function validateMessage(value: unknown, eventName: string | undefined, runId: string): RunStreamMessage {
  if (!isRecord(value)
    || !isOneOf(value.type, EVENT_TYPES)
    || value.type !== eventName
    || !isNonNegativeInteger(value.sequence)
    || value.runId !== runId
    || typeof value.emittedAt !== "string"
    || Number.isNaN(Date.parse(value.emittedAt))) {
    throw new RunStreamProtocolError("回放事件流包含非法或跨 run payload");
  }
  if (value.sampleIndex !== undefined && !isNonNegativeInteger(value.sampleIndex)) {
    throw new RunStreamProtocolError("回放事件流包含非法 sampleIndex");
  }
  if (value.state !== undefined && !isOneOf(value.state, RUN_STATES)) {
    throw new RunStreamProtocolError("回放事件流包含非法 state");
  }
  if (value.inference !== undefined) validateInference(value.inference, runId);
  if (value.eventId !== undefined && typeof value.eventId !== "string") {
    throw new RunStreamProtocolError("回放事件流包含非法 eventId");
  }
  if (value.diagnosisState !== undefined && !isOneOf(value.diagnosisState, DIAGNOSIS_STATES)) {
    throw new RunStreamProtocolError("回放事件流包含非法 diagnosisState");
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    throw new RunStreamProtocolError("回放事件流包含非法 message");
  }
  if (value.errorCode !== undefined && typeof value.errorCode !== "string") {
    throw new RunStreamProtocolError("回放事件流包含非法 errorCode");
  }
  return value as RunStreamMessage;
}

function parseFrame(frame: SseFrame, runId: string): RunStreamMessage | null {
  if (!frame.event && frame.data.length === 0) return null;
  if (!frame.event || frame.data.length === 0) {
    throw new RunStreamProtocolError("回放事件流 frame 缺少 event 或 data");
  }
  let value: unknown;
  try {
    value = JSON.parse(frame.data.join("\n"));
  } catch {
    throw new RunStreamProtocolError("回放事件流 data 不是合法 JSON");
  }
  return validateMessage(value, frame.event, runId);
}

function dispatchMessage(message: RunStreamMessage, handlers: RunStreamHandlers): void {
  handlers.onMessage?.(message);
  handlers.onEvent?.(message);
  switch (message.type) {
    case "state": handlers.onState?.(message); break;
    case "inference": handlers.onInference?.(message); break;
    case "anomaly_opened": handlers.onAnomalyOpened?.(message); break;
    case "diagnosis_updated": handlers.onDiagnosisUpdated?.(message); break;
    case "completed": handlers.onCompleted?.(message); break;
    case "failed": handlers.onFailed?.(message); break;
    case "heartbeat": handlers.onHeartbeat?.(message); break;
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function subscribeToRun(
  runId: string,
  handlers: RunStreamHandlers,
  options: RunStreamOptions = {},
): () => void {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let cursor = options.initialLastEventId;
  let activeReader: StreamReader | null = null;
  let stopped = false;
  let terminal = false;
  let retryDelay = Math.max(0, options.retryBaseDelayMs ?? 250);
  const maxRetryDelay = Math.max(retryDelay, options.maxRetryDelayMs ?? 8_000);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const apiBaseUrl = options.apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

  const abort = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    void activeReader?.cancel().catch(() => undefined);
  };
  const onExternalAbort = () => abort();
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const streamUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/runs/${runId}/stream`;

  const consumeConnection = async () => {
    const session = readSession();
    const headers = new Headers({ Accept: "text/event-stream" });
    if (session) headers.set("Authorization", `Bearer ${session.token}`);
    if (cursor) headers.set("Last-Event-ID", cursor);
    const response = await fetchImpl(streamUrl, { headers, signal: controller.signal });
    if (!response.ok) throw new RunStreamHttpError(response.status);
    if (!response.body) throw new RunStreamProtocolError("回放事件流缺少响应 body");
    handlers.onOpen?.();

    const reader = response.body.getReader();
    activeReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    let frame: SseFrame = { data: [] };

    const consumeLine = (rawLine: string) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        const message = parseFrame(frame, runId);
        const frameId = frame.id;
        frame = { data: [] };
        if (message) {
          if (frameId) cursor = frameId;
          dispatchMessage(message, handlers);
          if (message.type === "completed" || message.type === "failed") terminal = true;
        }
        return;
      }
      if (line.startsWith(":")) return;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") frame.event = value;
      else if (field === "data") frame.data.push(value);
      else if (field === "id" && /^\d+$/.test(value)) frame.id = value;
    };

    try {
      while (!controller.signal.aborted && !terminal) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0 && !terminal) {
          consumeLine(buffer.slice(0, newlineIndex));
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");
        }
      }
      if (!terminal && !controller.signal.aborted) {
        buffer += decoder.decode();
        if (buffer) consumeLine(buffer);
      }
      if (terminal) await reader.cancel().catch(() => undefined);
    } catch (cause) {
      await reader.cancel().catch(() => undefined);
      throw cause;
    } finally {
      activeReader = null;
      reader.releaseLock();
    }
  };

  const run = async () => {
    try {
      while (!stopped && !terminal) {
        try {
          await consumeConnection();
        } catch (cause) {
          if (controller.signal.aborted || stopped || terminal) break;
          const error = toError(cause);
          handlers.onError?.(error);
          if (cause instanceof RunStreamProtocolError || cause instanceof RunStreamHttpError) {
            stopped = true;
            break;
          }
        }
        if (!stopped && !terminal) {
          await waitForRetry(retryDelay, controller.signal);
          retryDelay = Math.min(maxRetryDelay, Math.max(1, retryDelay * 2));
        }
      }
    } finally {
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  };

  void run();
  return abort;
}
