import { z } from "zod";

export const missionRequestSchema = z.object({
  text: z.string().trim().min(12).max(3000),
  mode: z.enum(["solve", "auto-adjust"]).default("solve"),
});
