import { executeMission } from "@/lib/mission/orchestrator";
import { parseMission } from "@/lib/mission/parser";
import { TutuProvider } from "@/lib/tutu/provider";
import { missionRequestSchema } from "./contract";
import { missionErrorResponse } from "./errors";

// A module-scoped provider keeps the short-lived cache and in-flight request
// coalescing alive across Route Handler invocations in the same server process.
const provider = new TutuProvider();

export async function POST(request: Request) {
  try {
    const input = missionRequestSchema.parse(await request.json());
    const requestId = request.headers.get("x-mission-request-id") ?? crypto.randomUUID();
    const response = await executeMission(input.text, {
      mode: input.mode,
      requestId,
      signal: request.signal,
      parser: parseMission,
      provider,
    });
    return Response.json(response, { headers: { "x-mission-request-id": requestId } });
  } catch (error) {
    return missionErrorResponse(error);
  }
}
