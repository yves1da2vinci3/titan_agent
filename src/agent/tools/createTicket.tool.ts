import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { redisClient } from "../../memory/sessionMemory";
import { env } from "../../config/env";
import { sessionStorage } from "../../utils/sessionContext";

// Mapping from titan-agent breakdown types → ticketSystem breakdown types
const BREAKDOWN_TYPE_MAP: Record<string, string> = {
  total_individual: "total_individual",
  partial_individual: "minor_slowness",
  slow_connection: "minor_slowness",
  payment_failure: "other",
  gift_not_received: "other",
  challenge_issue: "other",
  other: "other",
};

const createTicketSchema = z.object({
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

type SessionMeta = {
  clientId: string;
  zoneId?: string;
  title?: string;
  category?: string;
  agentName?: string;
};

export const createTicketTool = new DynamicStructuredTool({
  name: "createTicket",
  description:
    "Crée un ticket de support. N'utiliser QUE si le client a explicitement accepté.",
  schema: createTicketSchema,
  func: async ({
    productType,
    breakdownType,
    description,
    intent,
    extractedAddress,
  }: CreateTicketInput): Promise<string> => {
    // sessionId is injected via AsyncLocalStorage — never passed by the AI
    const sessionId = sessionStorage.getStore() ?? "";
    const metaRaw = sessionId ? await redisClient.get(`titan-agent:meta:${sessionId}`) : null;
    const meta: SessionMeta = metaRaw
      ? (JSON.parse(metaRaw) as SessionMeta)
      : { clientId: "0" };

    const clientId = parseInt(meta.clientId, 10) || 0;
    const zoneId = parseInt(meta.zoneId ?? "0", 10) || 0;

    if (!clientId || !zoneId) {
      console.warn(`[createTicket] clientId=${clientId} zoneId=${zoneId} — informations de session incomplètes`);
    }

    const mappedBreakdownType = BREAKDOWN_TYPE_MAP[breakdownType] ?? "other";
    const sourceMetadata = JSON.stringify({
      language: "fr",
      intent,
      extractedAddress: extractedAddress ?? "",
      originalBreakdownType: breakdownType,
      description,
    });

    // Try ticketSystem HTTP API first
    if (env.TICKET_SYSTEM_URL && env.TICKET_SYSTEM_SECRET) {
      try {
        const payload = {
          client_id: clientId,
          zone_id: zoneId,
          product_type: productType,
          breakdown_type: mappedBreakdownType,
          intervention_type: "incident",
          source_conversation_id: sessionId,
          source_metadata: sourceMetadata,
        };

        const response = await fetch(`${env.TICKET_SYSTEM_URL}/api/tickets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": env.TICKET_SYSTEM_SECRET,
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = (await response.json()) as { reference?: string };
          const ref = data.reference ? ` (réf: ${data.reference})` : "";
          return `Ticket créé avec succès${ref}. Un technicien va vous contacter très prochainement.`;
        }
        console.error(`[createTicket] ticketSystem responded with ${response.status}`);
      } catch (err) {
        console.error("[createTicket] Erreur appel ticketSystem:", err);
      }
    }

    // Fallback: push to Redis list (legacy)
    try {
      const fallbackPayload = JSON.stringify({
        clientId: meta.clientId,
        zoneId: meta.zoneId ?? "",
        productType,
        breakdownType: mappedBreakdownType,
        description,
        conversationId: sessionId,
        channel: env.CHANNEL,
        metadata: {
          language: "fr",
          intent,
          extractedAddress: extractedAddress ?? "",
        },
      });
      await redisClient.lPush(env.TICKET_QUEUE_KEY, fallbackPayload);
      return "Ticket enregistré avec succès. Un technicien va vous contacter très prochainement.";
    } catch (err) {
      console.error("Erreur enregistrement ticket:", err);
      return "Impossible d'enregistrer le ticket pour l'instant. Veuillez réessayer dans quelques minutes.";
    }
  },
});
