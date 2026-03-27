import { Server, Socket } from "socket.io";
import { redisClient, getSessionHistory } from "../memory/sessionMemory";
import { invokeSupportAgent } from "../agent/titanAgent";
import { parseAgentResponse } from "../agent/responseParser";
import { env } from "../config/env";

// ─── Guardrail ────────────────────────────────────────────────────────────────

const ANGER_KEYWORDS = [
  "idiot", "idiote", "nul", "nulle", "merde", "incompétent", "incompétente",
  "arnaque", "escroc", "inutile", "useless", "stupide", "con ", "connard",
];

function detectAnger(text: string): boolean {
  const t = text.toLowerCase();
  return ANGER_KEYWORDS.some((k) => t.includes(k));
}

// ─── Content extraction helpers ───────────────────────────────────────────────

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

// ─── Socket handlers ──────────────────────────────────────────────────────────

export function registerChatHandlers(io: Server): void {
  io.on("connection", async (socket: Socket) => {
    const query = socket.handshake.query as Record<string, string | undefined>;
    const sessionId = (query.sessionId ?? socket.id) as string;
    const clientId = (query.clientId ?? "unknown") as string;

    console.log(`🔌 Client connecté — sessionId: ${sessionId}, clientId: ${clientId}`);

    // Persiste clientId dans Redis avec le TTL de session
    await redisClient.setEx(
      `titan-agent:meta:${sessionId}`,
      env.SESSION_TTL_SECONDS,
      JSON.stringify({ clientId })
    );

    // ── Envoie l'historique existant au client (reconnexion avant TTL) ─────────
    try {
      const history = getSessionHistory(sessionId);
      const pastMessages = await history.getMessages();

      if (pastMessages.length > 0) {
        const formatted = pastMessages.map((m) => ({
          role: m._getType() === "human" ? "user" : "agent",
          text: extractTextFromContent(m.content),
        }));
        socket.emit("chat:history", { messages: formatted });
        console.log(`📜 Historique restauré — ${formatted.length} messages`);
      }
    } catch (err) {
      console.error("Erreur récupération historique:", err);
    }

    // ── Écoute les messages ───────────────────────────────────────────────────
    socket.on("chat:message", async (data: { text: string }) => {
      const userMessage = data?.text?.trim();
      if (!userMessage) return;

      console.log(`💬 [${sessionId}] User: ${userMessage}`);

      // 1. Guardrail — détection de colère
      if (detectAnger(userMessage)) {
        socket.emit("chat:escalate", {
          message:
            "Je comprends votre frustration. Permettez-moi de vous transférer vers un agent humain qui pourra mieux vous aider.",
        });
        return;
      }

      socket.emit("chat:typing", { typing: true });

      try {
        // 2. Invoke support agent
        const rawText = await invokeSupportAgent(userMessage, sessionId);
        const parsed = parseAgentResponse(rawText);

        console.log(`🤖 [${sessionId}] Agent: ${parsed.message.slice(0, 80)}...`);
        if (parsed.buttons) {
          console.log(`   Buttons: ${parsed.buttons.join(", ")}`);
        }

        // 3. Émet la réponse finale structurée
        socket.emit("chat:typing", { typing: false });
        socket.emit("chat:reply", {
          text: parsed.message,
          buttons: parsed.buttons,
          action: parsed.action,
          timerSeconds: parsed.timerSeconds,
          sessionId,
        });
      } catch (err) {
        console.error(`❌ Erreur agent [${sessionId}]:`, err);
        socket.emit("chat:typing", { typing: false });
        socket.emit("chat:error", {
          message:
            "Désolé, une erreur est survenue. Veuillez réessayer dans un moment.",
        });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Client déconnecté — sessionId: ${sessionId}`);
    });
  });
}
