import { DynamicTool } from "@langchain/core/tools";
import { redisClient } from "../../memory/sessionMemory";
import { env } from "../../config/env";

interface TicketInput {
  sessionId: string;
  productType: "t_box" | "t_mobile";
  breakdownType:
    | "total_individual"
    | "partial_individual"
    | "slow_connection"
    | "payment_failure"
    | "gift_not_received"
    | "challenge_issue"
    | "other";
  description: string;
  intent: "outage" | "slow" | "payment" | "gifting" | "challenge" | "other";
  extractedAddress?: string;
}

export const createTicketTool = new DynamicTool({
  name: "createTicket",
  description: `Publie un événement ticket dans la queue Redis quand le problème est clairement identifié et que le client a accepté.
Input doit être un JSON valide avec les champs : sessionId, productType ("t_box" ou "t_mobile"), breakdownType, description, intent, extractedAddress (optionnel).`,
  func: async (input: string): Promise<string> => {
    let body: TicketInput;
    try {
      body = JSON.parse(input) as TicketInput;
    } catch {
      return "Impossible de créer le ticket : données invalides. Veuillez réessayer.";
    }

    // Récupère clientId depuis les métadonnées de session Redis
    const metaRaw = await redisClient.get(`titan-agent:meta:${body.sessionId}`);
    const { clientId } = metaRaw
      ? (JSON.parse(metaRaw) as { clientId: string })
      : { clientId: "unknown" };

    const payload = JSON.stringify({
      clientId,
      productType: body.productType,
      breakdownType: body.breakdownType,
      description: body.description,
      conversationId: body.sessionId,
      channel: env.CHANNEL,
      metadata: {
        language: "fr",
        intent: body.intent,
        extractedAddress: body.extractedAddress ?? "",
      },
    });

    try {
      await redisClient.lPush(env.TICKET_QUEUE_KEY, payload);
      return "Votre demande a bien été enregistrée. Un technicien va vous contacter très prochainement.";
    } catch (err) {
      console.error("Erreur lors du LPUSH Redis:", err);
      return "Impossible d'enregistrer votre demande pour l'instant. Veuillez réessayer dans quelques minutes.";
    }
  },
});
