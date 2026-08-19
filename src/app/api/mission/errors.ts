import { z } from "zod";
import { CurrencyRateUnavailableError } from "@/lib/currency/cbr";
import { MissionClarificationError, MissionUnsupportedError } from "@/lib/mission/parser";
import { TutuSearchUnavailableError } from "@/lib/tutu/provider";

export function missionErrorResponse(error: unknown) {
  if (error instanceof MissionUnsupportedError) {
    return Response.json({ status: "unsupported", error: error.message, code: error.code, details: error.details });
  }
  if (error instanceof MissionClarificationError) {
    return Response.json({ status: "clarification", error: error.message, code: error.code, questions: error.questions });
  }
  if (error instanceof TutuSearchUnavailableError || error instanceof CurrencyRateUnavailableError) {
    return Response.json({ error: error.message, code: error.code }, { status: 503, headers: { "Retry-After": "2" } });
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new Response(null, { status: 499 });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: "Проверьте текст задачи: запрос слишком короткий или неполный." }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Не удалось решить задачу";
  return Response.json({ error: message }, { status: 502 });
}
