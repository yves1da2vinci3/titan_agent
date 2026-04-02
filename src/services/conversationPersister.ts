import { redisClient } from "../memory/sessionMemory.js";
import { env } from "../config/env.js";

const PERSISTED_KEY_PREFIX = "titan-agent:persisted:";

export type MessageToSave = {
  role: "user" | "agent";
  content: string;
  createdAt: string; // ISO string
};

export type SessionMeta = {
  clientId: string;
  zoneId?: string;
  title?: string;
  category?: string;
  agentName?: string;
};

/**
 * Returns true if this session has already been persisted to the server DB.
 * Prevents duplicate saves on disconnect after explicit chat:end.
 */
export async function isAlreadyPersisted(sessionId: string): Promise<boolean> {
  const val = await redisClient.get(`${PERSISTED_KEY_PREFIX}${sessionId}`);
  return val === "1";
}

/**
 * Marks a session as persisted in Redis (short TTL since it's just a guard).
 */
async function markAsPersisted(sessionId: string): Promise<void> {
  // Keep flag for 10 minutes to prevent duplicate persist on disconnect
  await redisClient.setEx(`${PERSISTED_KEY_PREFIX}${sessionId}`, 600, "1");
}

/**
 * Persists a conversation to the server's PostgreSQL via POST /internal/conversations.
 * If SERVER_URL or AGENT_INTERNAL_SECRET are not configured, logs a warning and returns false.
 */
export async function persistConversation(
  sessionId: string,
  meta: SessionMeta,
  messages: MessageToSave[],
  startedAt: Date,
): Promise<boolean> {
  if (!env.SERVER_URL || !env.AGENT_INTERNAL_SECRET) {
    console.warn("[conversationPersister] SERVER_URL ou AGENT_INTERNAL_SECRET non configuré — skip persistance");
    return false;
  }

  const clientId = parseInt(meta.clientId, 10) || 0;
  if (!clientId || messages.length === 0) {
    return false;
  }

  const endedAt = new Date().toISOString();

  const payload = {
    session_id: sessionId,
    client_id: clientId,
    title: meta.title ?? "",
    category: meta.category ?? "other",
    agent_name: meta.agentName ?? "Support Titan",
    agent_version: "titan-agent-v1",
    started_at: startedAt.toISOString(),
    ended_at: endedAt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      created_at: m.createdAt,
    })),
  };

  try {
    const response = await fetch(`${env.SERVER_URL}/internal/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Secret": env.AGENT_INTERNAL_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok || response.status === 409) {
      await markAsPersisted(sessionId);
      console.log(`[conversationPersister] ✅ Conversation ${sessionId} persistée (${messages.length} messages)`);
      return true;
    }
    console.error(`[conversationPersister] Erreur serveur ${response.status}`);
    return false;
  } catch (err) {
    console.error("[conversationPersister] Erreur réseau:", err);
    return false;
  }
}

/**
 * Deletes all Redis keys for a session after persistence.
 */
export async function cleanupSession(sessionId: string): Promise<void> {
  await Promise.allSettled([
    redisClient.del(`titan-agent:history:${sessionId}`),
    redisClient.del(`titan-agent:meta:${sessionId}`),
  ]);
  console.log(`[conversationPersister] 🧹 Session Redis ${sessionId} nettoyée`);
}
