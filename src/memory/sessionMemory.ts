import { RedisChatMessageHistory } from "@langchain/redis";
import { createClient } from "redis";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { env } from "../config/env";

export const redisClient = createClient({ url: env.REDIS_URL });

redisClient.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

export async function connectRedis(): Promise<void> {
  await redisClient.connect();
  console.log("✅ Redis connecté");
}

export function getSessionHistory(sessionId: string): RedisChatMessageHistory {
  return new RedisChatMessageHistory({
    sessionId: `titan-agent:history:${sessionId}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: redisClient as any,
    sessionTTL: env.SESSION_TTL_SECONDS,
  });
}

const MAX_HISTORY_MESSAGES = 10;

/**
 * Retourne les N derniers messages de la session Redis (pour éviter
 * de surcharger le contexte du LLM sur les longues conversations).
 */
export async function getTrimmedHistory(
  sessionId: string
): Promise<BaseMessage[]> {
  const history = getSessionHistory(sessionId);
  const messages = await history.getMessages();
  // Garde les N derniers messages (toujours par paires human/AI si possible)
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * Ajoute un échange human/AI à l'historique Redis.
 */
export async function appendToHistory(
  sessionId: string,
  humanText: string,
  aiText: string
): Promise<void> {
  const history = getSessionHistory(sessionId);
  await history.addMessage(new HumanMessage(humanText));
  await history.addMessage(new AIMessage(aiText));
}
