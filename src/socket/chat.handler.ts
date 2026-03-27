import { Server, Socket } from "socket.io";
import { redisClient, getSessionHistory } from "../memory/sessionMemory";
import { invokeSupportAgent } from "../agent/titanAgent";
import { parseAgentResponse } from "../agent/responseParser";
import { env } from "../config/env";
import {
  persistConversation,
  cleanupSession,
  isAlreadyPersisted,
  type MessageToSave,
  type SessionMeta,
} from "../services/conversationPersister";
import { fetchArchivedConversation } from "../services/conversationFetcher";

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

// ─── Conversation title/category extraction ───────────────────────────────────

async function extractConversationMeta(
  userMessage: string,
  sessionMeta: SessionMeta,
): Promise<{ title: string; category: string }> {
  // Only extract on first message (no title yet)
  if (sessionMeta.title) {
    return { title: sessionMeta.title, category: sessionMeta.category ?? "other" };
  }

  // Use a simple heuristic: truncate user message for title, map keywords to category
  const title = userMessage.length > 60
    ? userMessage.substring(0, 57) + "..."
    : userMessage;

  const lower = userMessage.toLowerCase();
  let category = "other";
  if (lower.includes("wifi") || lower.includes("internet") || lower.includes("connexion") || lower.includes("réseau") || lower.includes("fibre")) {
    category = "wifi";
  } else if (lower.includes("paiement") || lower.includes("facture") || lower.includes("recharge") || lower.includes("argent") || lower.includes("rembours")) {
    category = "payment";
  } else if (lower.includes("cadeau") || lower.includes("don") || lower.includes("partage") || lower.includes("gifting")) {
    category = "gifting";
  } else if (lower.includes("compte") || lower.includes("profil") || lower.includes("mot de passe") || lower.includes("connexion")) {
    category = "account";
  }

  return { title, category };
}

// ─── Helpers to build MessageToSave list from Redis history ──────────────────

async function buildMessagesToSave(sessionId: string): Promise<MessageToSave[]> {
  try {
    const history = getSessionHistory(sessionId);
    const pastMessages = await history.getMessages();
    return pastMessages.map((m, i) => ({
      role: m._getType() === "human" ? "user" : "agent",
      content: extractTextFromContent(m.content),
      createdAt: new Date(Date.now() - (pastMessages.length - i) * 1000).toISOString(),
    }));
  } catch {
    return [];
  }
}

// ─── Socket handlers ──────────────────────────────────────────────────────────

export function registerChatHandlers(io: Server): void {
  io.on("connection", async (socket: Socket) => {
    const query = socket.handshake.query as Record<string, string | undefined>;
    const sessionId = (query.sessionId ?? socket.id) as string;
    const clientId = (query.clientId ?? "unknown") as string;
    const zoneId = (query.zoneId ?? "0") as string;

    const sessionStartedAt = new Date();

    console.log(`🔌 Client connecté — sessionId: ${sessionId}, clientId: ${clientId}, zoneId: ${zoneId}`);

    // Load existing meta (for reconnects) or initialize
    const existingMetaRaw = await redisClient.get(`titan-agent:meta:${sessionId}`);
    const existingMeta: SessionMeta = existingMetaRaw
      ? (JSON.parse(existingMetaRaw) as SessionMeta)
      : { clientId, zoneId };

    // Always refresh TTL and update clientId/zoneId
    const updatedMeta: SessionMeta = { ...existingMeta, clientId, zoneId };
    await redisClient.setEx(
      `titan-agent:meta:${sessionId}`,
      env.SESSION_TTL_SECONDS,
      JSON.stringify(updatedMeta),
    );

    // ── Shadow key pour persistence TTL ──────────────────────────────────────
    const shadowTTL = Math.max(env.SESSION_TTL_SECONDS - 60, 60);
    await redisClient.setEx(`titan-agent:shadow:${sessionId}`, shadowTTL, "1");

    // ── Envoie l'historique existant au client ─────────────────────────────────
    let hadHistory = false;
    try {
      const history = getSessionHistory(sessionId);
      const pastMessages = await history.getMessages();

      if (pastMessages.length > 0) {
        hadHistory = true;
        const formatted = pastMessages.map((m) => ({
          role: m._getType() === "human" ? "user" : "agent",
          text: extractTextFromContent(m.content),
        }));
        socket.emit("chat:history", {
          messages: formatted,
          meta: {
            title: updatedMeta.title,
            category: updatedMeta.category,
          },
        });
        console.log(`📜 Historique Redis restauré — ${formatted.length} messages`);
      } else {
        // Redis miss — try to recover from server PostgreSQL
        const archived = await fetchArchivedConversation(sessionId);
        if (archived && archived.length > 0) {
          hadHistory = true;
          socket.emit("chat:history", {
            messages: archived,
            source: "archive",
          });
          console.log(`📂 Historique DB restauré — ${archived.length} messages`);
        }
      }
    } catch (err) {
      console.error("Erreur récupération historique:", err);
    }

    // ── Message de bienvenue si nouvelle session ───────────────────────────────
    if (!hadHistory) {
      socket.emit("chat:reply", {
        text: "Bonjour ! Je suis votre assistant Titan. Comment puis-je vous aider aujourd'hui ?\n\n💡 Lorsque votre problème est résolu, appuyez sur **Terminer** pour clôturer la conversation.",
        sessionId,
      });
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
        // 2. Extract/update conversation meta on first message
        const currentMetaRaw = await redisClient.get(`titan-agent:meta:${sessionId}`);
        const currentMeta: SessionMeta = currentMetaRaw
          ? (JSON.parse(currentMetaRaw) as SessionMeta)
          : { clientId, zoneId };

        if (!currentMeta.title) {
          const { title, category } = await extractConversationMeta(userMessage, currentMeta);
          const newMeta: SessionMeta = { ...currentMeta, title, category };
          await redisClient.setEx(
            `titan-agent:meta:${sessionId}`,
            env.SESSION_TTL_SECONDS,
            JSON.stringify(newMeta),
          );
        }

        // Refresh shadow key TTL on each message (keeps the 60s gap intact)
        const shadowTTL = Math.max(env.SESSION_TTL_SECONDS - 60, 60);
        await redisClient.setEx(`titan-agent:shadow:${sessionId}`, shadowTTL, "1");

        // 3. Invoke support agent
        const rawText = await invokeSupportAgent(userMessage, sessionId);
        const parsed = parseAgentResponse(rawText);

        console.log(`🤖 [${sessionId}] Agent: ${parsed.message.slice(0, 80)}...`);
        if (parsed.buttons) {
          console.log(`   Buttons: ${parsed.buttons.join(", ")}`);
        }

        // 4. Émet la réponse finale structurée
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

    // ── Fin de conversation explicite ─────────────────────────────────────────
    socket.on("chat:end", async () => {
      console.log(`🏁 [${sessionId}] Fin de conversation demandée`);

      const alreadyDone = await isAlreadyPersisted(sessionId);
      if (alreadyDone) {
        socket.emit("chat:session_ended", { sessionId });
        return;
      }

      const metaRaw = await redisClient.get(`titan-agent:meta:${sessionId}`);
      const meta: SessionMeta = metaRaw
        ? (JSON.parse(metaRaw) as SessionMeta)
        : { clientId, zoneId };

      const messages = await buildMessagesToSave(sessionId);

      if (messages.length > 0) {
        const persisted = await persistConversation(sessionId, meta, messages, sessionStartedAt);
        if (persisted) {
          await redisClient.del(`titan-agent:shadow:${sessionId}`);
          await cleanupSession(sessionId);
        } else {
          console.warn(`[chat:end] Persistance échouée pour ${sessionId} — Redis conservé`);
        }
      }

      socket.emit("chat:session_ended", { sessionId });
    });

    // ── Déconnexion ───────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      console.log(`🔌 Client déconnecté — sessionId: ${sessionId}`);

      // Auto-persist on disconnect if not already done and session has messages
      const alreadyDone = await isAlreadyPersisted(sessionId);
      if (alreadyDone) return;

      try {
        const metaRaw = await redisClient.get(`titan-agent:meta:${sessionId}`);
        const meta: SessionMeta = metaRaw
          ? (JSON.parse(metaRaw) as SessionMeta)
          : { clientId, zoneId };

        const messages = await buildMessagesToSave(sessionId);
        if (messages.length > 0) {
          await persistConversation(sessionId, meta, messages, sessionStartedAt);
          // Note: don't cleanupSession on disconnect — keep Redis alive for reconnect within TTL
        }
      } catch (err) {
        console.error(`[disconnect] Erreur persistance [${sessionId}]:`, err);
      }
    });
  });
}
