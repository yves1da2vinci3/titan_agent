import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { redisClient } from "../../memory/sessionMemory";
import { env } from "../../config/env";

const createTicketSchema = z.object({
  sessionId: z.string(),
  productType: z.enum(["t_box", "t_mobile"]),
  breakdownType: z.enum([
    "total_individual",
    "partial_individual",
    "slow_connection",
    "payment_failure",
    "gift_not_received",
    "challenge_issue",
    "other",
  ]),
  description: z.string(),
  intent: z.enum(["outage", "slow", "payment", "gifting", "challenge", "other"]),
  extractedAddress: z.string().optional(),
});

type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const createTicketTool = new DynamicStructuredTool({
  name: "createTicket",
  description:
    "Publie un ticket dans la queue Redis. N'utiliser QUE si le client a explicitement accepté.",
  schema: createTicketSchema,
  func: async ({
    sessionId,
    productType,
    breakdownType,
    description,
    intent,
    extractedAddress,
  }: CreateTicketInput): Promise<string> => {
    const metaRaw = await redisClient.get(`titan-agent:meta:${sessionId}`);
    const { clientId } = metaRaw
      ? (JSON.parse(metaRaw) as { clientId: string })
      : { clientId: "unknown" };

    const payload = JSON.stringify({
      clientId,
      productType,
      breakdownType,
      description,
      conversationId: sessionId,
      channel: env.CHANNEL,
      metadata: {
        language: "fr",
        intent,
        extractedAddress: extractedAddress ?? "",
      },
    });

    try {
      await redisClient.lPush(env.TICKET_QUEUE_KEY, payload);
      return "Ticket enregistré avec succès. Un technicien va vous contacter très prochainement.";
    } catch (err) {
      console.error("Erreur LPUSH Redis:", err);
      return "Impossible d'enregistrer le ticket pour l'instant. Veuillez réessayer dans quelques minutes.";
    }
  },
});
