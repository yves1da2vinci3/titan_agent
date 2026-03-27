import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const startTimerSchema = z.object({
  seconds: z.number(),
  reason: z.string(),
});

type StartTimerInput = z.infer<typeof startTimerSchema>;

export const startTimerTool = new DynamicStructuredTool({
  name: "startTimer",
  description:
    "Déclenche un compte à rebours côté client. Utiliser pour le reset de la BOX (3 min = 180 secondes).",
  schema: startTimerSchema,
  func: async ({ seconds }: StartTimerInput): Promise<string> => {
    return `TIMER_STARTED:${seconds}`;
  },
});
