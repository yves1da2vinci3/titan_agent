import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.string().default("3001"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY est requis"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  TICKET_QUEUE_KEY: z.string().default("titan:tickets:queue"),
  SESSION_TTL_SECONDS: z.coerce.number().default(1800),
  CHANNEL: z.string().default("chatbot"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Variables d'environnement manquantes ou invalides :");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
