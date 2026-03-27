import "./config/env"; // valide les variables d'env en premier
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { connectRedis, redisClient, getSessionHistory } from "./memory/sessionMemory";
import { registerChatHandlers } from "./socket/chat.handler";
import { env } from "./config/env";

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

async function bootstrap(): Promise<void> {
  // 1. Connexion Redis
  await connectRedis();

  // 2. Setup Express + Socket.io
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: "*", // à restreindre en production
      methods: ["GET", "POST"],
    },
  });

  // 3. Health check HTTP
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "titan-agent" });
  });

  // 4. Active sessions — called by titan-client ConversationHistoryScreen
  // GET /sessions/active?clientId=X
  app.get("/sessions/active", async (req, res) => {
    const clientId = req.query.clientId as string | undefined;
    if (!clientId) {
      res.status(400).json({ error: "clientId est requis" });
      return;
    }

    try {
      const sessions: {
        sessionId: string;
        clientId: string;
        zoneId: string;
        title: string;
        category: string;
        agentName: string;
        lastMessage: string;
        startedAt?: string;
      }[] = [];

      // SCAN for all session meta keys
      let cursor = 0;
      do {
        const result = await redisClient.scan(cursor, {
          MATCH: "titan-agent:meta:*",
          COUNT: 100,
        });
        cursor = result.cursor;

        for (const key of result.keys) {
          const raw = await redisClient.get(key);
          if (!raw) continue;
          try {
            const meta = JSON.parse(raw) as {
              clientId?: string;
              zoneId?: string;
              title?: string;
              category?: string;
              agentName?: string;
            };
            if (meta.clientId !== clientId) continue;

            const sessionId = key.replace("titan-agent:meta:", "");

            // Get last message from history
            let lastMessage = "";
            try {
              const history = getSessionHistory(sessionId);
              const msgs = await history.getMessages();
              if (msgs.length > 0) {
                const last = msgs[msgs.length - 1];
                lastMessage = extractTextFromContent(last.content);
                if (lastMessage.length > 120) {
                  lastMessage = lastMessage.substring(0, 117) + "...";
                }
              }
            } catch {
              // ignore history errors
            }

            sessions.push({
              sessionId,
              clientId: meta.clientId ?? clientId,
              zoneId: meta.zoneId ?? "0",
              title: meta.title ?? "",
              category: meta.category ?? "other",
              agentName: meta.agentName ?? "Support Titan",
              lastMessage,
            });
          } catch {
            // skip malformed meta
          }
        }
      } while (cursor !== 0);

      res.json({ data: sessions });
    } catch (err) {
      console.error("[GET /sessions/active]", err);
      res.status(500).json({ error: "Erreur interne" });
    }
  });

  // 5. Enregistre les handlers Socket.io
  registerChatHandlers(io);

  // 6. Démarre le serveur
  httpServer.listen(Number(env.PORT), () => {
    console.log(`🚀 titan-agent démarré sur le port ${env.PORT}`);
    console.log(`📡 Socket.io en écoute...`);
    console.log(`🔗 Health check : http://localhost:${env.PORT}/health`);
    console.log(`📋 Sessions actives : http://localhost:${env.PORT}/sessions/active?clientId=X`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ Erreur fatale au démarrage:", err);
  process.exit(1);
});
