import type { BaseMessage } from "@langchain/core/messages";
import { createClient } from "redis";
import { env } from "../config/env.js";
import { redisClient, getSessionHistory } from "../memory/sessionMemory.js";
import { persistConversation, isAlreadyPersisted } from "./conversationPersister.js";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

export async function startTTLWatcher(): Promise<void> {
  const subscriber = createClient({ url: env.REDIS_URL });

  subscriber.on("error", (err) => {
    console.error("[ttlWatcher] Redis subscriber error:", err);
  });

  await subscriber.connect();

  // Enable keyspace notifications for expired events (idempotent)
  await subscriber.configSet("notify-keyspace-events", "Ex");

  await subscriber.subscribe("__keyevent@0__:expired", async (key: string) => {
    if (!key.startsWith("titan-agent:shadow:")) return;

    const sessionId = key.slice("titan-agent:shadow:".length);
    console.log(`[ttlWatcher] ⏰ Shadow key expiré — sessionId: ${sessionId}`);

    const alreadyDone = await isAlreadyPersisted(sessionId);
    if (alreadyDone) {
      console.log(`[ttlWatcher] Session ${sessionId} déjà persistée — skip`);
      return;
    }

    try {
      const history = getSessionHistory(sessionId);
      const pastMessages = await history.getMessages();
      if (pastMessages.length === 0) return;

      const metaRaw = await redisClient.get(`titan-agent:meta:${sessionId}`);
      const meta = metaRaw ? (JSON.parse(metaRaw) as { clientId: string; zoneId?: string; title?: string; category?: string; agentName?: string }) : { clientId: "unknown" };

      const messages = pastMessages.map((m: BaseMessage, i: number) => ({
        role: (m._getType() === "human" ? "user" : "agent") as "user" | "agent",
        content: extractText(m.content),
        createdAt: new Date(Date.now() - (pastMessages.length - i) * 1000).toISOString(),
      }));

      const startedAt = new Date(Date.now() - env.SESSION_TTL_SECONDS * 1000);
      await persistConversation(sessionId, meta, messages, startedAt);
      console.log(`[ttlWatcher] ✅ Session ${sessionId} persistée via TTL expiry (${messages.length} messages)`);
    } catch (err) {
      console.error(`[ttlWatcher] Erreur persist TTL [${sessionId}]:`, err);
    }
  });

  console.log("✅ TTL Watcher démarré");
}
