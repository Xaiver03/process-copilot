import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeToRun, type RunStreamMessage } from "@/lib/run-stream";

const runId = "11111111-1111-4111-8111-111111111111";

function responseFromChunks(chunks: string[], onCancel?: () => void): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function stateMessage(sequence: number, state: RunStreamMessage["state"] = "playing") {
  return JSON.stringify({
    type: "state",
    sequence,
    runId,
    emittedAt: "2026-08-28T12:00:00.000Z",
    state,
  });
}

function completedMessage(sequence: number) {
  return JSON.stringify({
    type: "completed",
    sequence,
    runId,
    emittedAt: "2026-08-28T12:00:01.000Z",
    state: "completed",
  });
}

describe("subscribeToRun", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses frames split across chunks and joins multiple data lines", async () => {
    const onMessage = vi.fn();
    const unsubscribe = subscribeToRun(runId, { onMessage }, {
      fetchImpl: vi.fn().mockResolvedValue(responseFromChunks([
        `id: 1\nevent: state\ndata: {"type":"state","sequence":1,\n`,
        `data: "runId":"${runId}","emittedAt":"2026-08-28T12:00:00.000Z",\n`,
        `data: "state":"playing"}\n\n`,
        `id: 2\nevent: completed\ndata: ${completedMessage(2)}\n\n`,
      ])),
    });

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2));
    expect(onMessage.mock.calls[0][0]).toMatchObject({ type: "state", sequence: 1, state: "playing" });
    expect(onMessage.mock.calls[1][0]).toMatchObject({ type: "completed", sequence: 2 });
    unsubscribe();
  });

  it("reconnects after stream end with the last SSE id", async () => {
    const onMessage = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(responseFromChunks([`id: 7\nevent: state\ndata: ${stateMessage(7)}\n\n`]))
      .mockResolvedValueOnce(responseFromChunks([`id: 8\nevent: completed\ndata: ${completedMessage(8)}\n\n`]));
    subscribeToRun(runId, { onMessage }, { fetchImpl, retryBaseDelayMs: 1 });

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondRequest = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(new Headers(secondRequest.headers).get("Last-Event-ID")).toBe("7");
  });

  it("stops permanently after completed or failed", async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(responseFromChunks([
      `id: 9\nevent: failed\ndata: ${JSON.stringify({
        type: "failed",
        sequence: 9,
        runId,
        emittedAt: "2026-08-28T12:00:02.000Z",
        state: "failed",
        errorCode: "worker_failed",
      })}\n\n`,
    ]));
    subscribeToRun(runId, { onMessage, onError }, { fetchImpl, retryBaseDelayMs: 1 });

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("cancels the reader and prevents reconnect on abort", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reader = {
      read: vi.fn(() => new Promise<never>(() => {})),
      cancel,
      releaseLock: vi.fn(),
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } } as unknown as Response);
    const controller = new AbortController();
    const unsubscribe = subscribeToRun(runId, {}, { fetchImpl, signal: controller.signal, retryBaseDelayMs: 1 });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("rejects an invalid payload without delivering it or reconnecting", async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(responseFromChunks([
      `id: 10\nevent: inference\ndata: ${JSON.stringify({
        type: "inference",
        sequence: 10,
        runId: "another-run",
        emittedAt: "2026-08-28T12:00:03.000Z",
      })}\n\n`,
    ]));
    subscribeToRun(runId, { onMessage, onError }, { fetchImpl, retryBaseDelayMs: 1 });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onMessage).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
