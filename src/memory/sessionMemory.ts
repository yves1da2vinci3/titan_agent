import { RedisChatMessageHistory } from "@langchain/redis";
import { createClient } from "redis";
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
