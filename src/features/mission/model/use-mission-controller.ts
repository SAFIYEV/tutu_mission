"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { missionResponseSchema, type MissionResponse } from "@/lib/mission/schema";

export type MissionScreen = "create" | "solving" | "result" | "error" | "clarification";
export type MissionSubmitMode = "solve" | "auto-adjust";

const TRANSIENT_CODES = new Set(["TUTU_MCP_UNAVAILABLE", "CURRENCY_RATE_UNAVAILABLE"]);
const MAX_API_ATTEMPTS = 3;

type ActiveRequest = {
  id: string;
  controller: AbortController;
};

type ApiErrorPayload = {
  error?: string;
  code?: string;
  questions?: unknown;
  details?: unknown;
};

export function useMissionController() {
  const [screen, setScreen] = useState<MissionScreen>("create");
  const [text, setText] = useState("");
  const [response, setResponse] = useState<MissionResponse | null>(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [unsupported, setUnsupported] = useState(false);
  const activeRequest = useRef<ActiveRequest | null>(null);

  useEffect(() => () => activeRequest.current?.controller.abort(), []);

  const reset = useCallback(() => {
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
    setScreen("create");
  }, []);

  const showResult = useCallback(() => setScreen("result"), []);

  const submit = useCallback(async (value: string, mode: MissionSubmitMode = "solve") => {
    activeRequest.current?.controller.abort();
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    activeRequest.current = { id: requestId, controller };
    setText(value);
    setResponse(null);
    setError("");
    setErrorCode("");
    setScreen("solving");

    try {
      const { result, payload } = await requestMissionWithRecovery({ value, mode, requestId, signal: controller.signal });
      if (activeRequest.current?.id !== requestId) return;
      if (payload.code === "MISSION_UNSUPPORTED") {
        setQuestions(toMessages(payload.details, payload.error));
        setUnsupported(true);
        setScreen("clarification");
        return;
      }
      if (payload.code === "MISSION_NEEDS_CLARIFICATION") {
        setQuestions(toMessages(payload.questions, payload.error));
        setUnsupported(false);
        setScreen("clarification");
        return;
      }
      if (!result.ok) {
        setErrorCode(typeof payload.code === "string" ? payload.code : "");
        throw new Error(payload.error ?? "Не удалось решить задачу");
      }
      const validated = missionResponseSchema.safeParse(payload);
      if (!validated.success) throw new Error("Сервер вернул некорректный результат миссии");
      setResponse(validated.data);
    } catch (cause) {
      if (controller.signal.aborted || cause instanceof DOMException && cause.name === "AbortError") return;
      if (activeRequest.current?.id !== requestId) return;
      setError(cause instanceof Error ? cause.message : "Не удалось связаться с Туту");
      setScreen("error");
    } finally {
      if (activeRequest.current?.id === requestId) activeRequest.current = null;
    }
  }, []);

  return { screen, text, response, error, errorCode, questions, unsupported, submit, reset, showResult };
}

async function requestMissionWithRecovery(input: {
  value: string;
  mode: MissionSubmitMode;
  requestId: string;
  signal: AbortSignal;
}) {
  let lastResult: Response | null = null;
  let lastPayload: ApiErrorPayload = {};

  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt += 1) {
    try {
      lastResult = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "x-mission-request-id": input.requestId },
        body: JSON.stringify({ text: input.value, mode: input.mode }),
        signal: input.signal,
      });
      lastPayload = await lastResult.json() as ApiErrorPayload;
      if (lastResult.ok || !TRANSIENT_CODES.has(lastPayload.code ?? "") || attempt === MAX_API_ATTEMPTS) {
        return { result: lastResult, payload: lastPayload };
      }
    } catch (error) {
      if (input.signal.aborted || attempt === MAX_API_ATTEMPTS) throw error;
    }
    await abortableDelay(800 * 2 ** (attempt - 1), input.signal);
  }

  return { result: lastResult!, payload: lastPayload };
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function toMessages(value: unknown, fallback?: string) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [fallback ?? "Нужно уточнить условия поездки."];
}
