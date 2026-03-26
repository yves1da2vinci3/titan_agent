import "./config/env"; // valide les variables d'env en premier
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { connectRedis } from "./memory/sessionMemory";
import { registerChatHandlers } from "./socket/chat.handler";
import { env } from "./config/env";

async function bootstrap(): Promise<void> {
  // 1. Connexion Redis
  await connectRedis();

  // 2. Setup Express + Socket.io
  const app = express();
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

  // 4. Enregistre les handlers Socket.io
  registerChatHandlers(io);

  // 5. Démarre le serveur
  httpServer.listen(Number(env.PORT), () => {
    console.log(`🚀 titan-agent démarré sur le port ${env.PORT}`);
    console.log(`📡 Socket.io en écoute...`);
    console.log(`🔗 Health check : http://localhost:${env.PORT}/health`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ Erreur fatale au démarrage:", err);
  process.exit(1);
});
