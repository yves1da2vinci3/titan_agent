import { parseTitanReplyToPlainText } from "./titanReplyParse.js";

export interface ParsedResponse {
  message: string;
  buttons?: string[];
  action?: "start_timer";
  timerSeconds?: number;
}

/**
 * Extrait les marqueurs ##BUTTONS## et ##TIMER## d'une réponse de l'agent.
 * Normalise le JSON / fences via le même pipeline Zod + StructuredOutputParser que l'agent.
 */
export async function parseAgentResponse(raw: unknown): Promise<ParsedResponse> {
  let text = "";

  if (typeof raw === "string") {
    text = raw;
  } else if (Array.isArray(raw)) {
    text = raw
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  } else if (raw && typeof raw === "object") {
    if ("text" in raw) text = String((raw as { text: unknown }).text);
    else if ("message" in raw) text = String((raw as { message: unknown }).message);
    else text = JSON.stringify(raw);
  }

  text = await parseTitanReplyToPlainText(text);

  let message = text.trim();
  let buttons: string[] | undefined;
  let action: "start_timer" | undefined;
  let timerSeconds: number | undefined;

  const buttonsMatch = message.match(/##BUTTONS##(\[[\s\S]*?\])/);
  if (buttonsMatch) {
    try {
      buttons = JSON.parse(buttonsMatch[1]) as string[];
    } catch {
      // ignore malformed JSON
    }
    message = message.replace(/##BUTTONS##\[[\s\S]*?\]/, "").trim();
  }

  const timerMatch = message.match(/##TIMER##(\d+)/);
  if (timerMatch) {
    timerSeconds = parseInt(timerMatch[1], 10);
    action = "start_timer";
    message = message.replace(/##TIMER##\d+/, "").trim();
  }

  message = message.replace(/\s+$/, "");
  if (!message) {
    message = "Je n'ai pas pu formuler une réponse claire pour le moment.";
  }

  return { message, buttons, action, timerSeconds };
}
