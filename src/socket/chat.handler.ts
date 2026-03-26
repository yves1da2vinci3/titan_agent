import { Server } from "socket.io";
import { redisClient, getSessionHistory } from "../memory/sessionMemory";
import { agentWithHistory } from "../agent/titanAgent";
import { env } from "../config/env";

export function registerChatHandlers(io: Server): void {
  io.on("connection", async (socket) => {
    const query = socket.handshake.query as Record<string, string | undefined>;
    const sessionId = query.sessionId ?? socket.id;
    const clientId = query.clientId ?? "unknown";

    console.log(`🔌 Client connecté — sessionId: ${sessionId}, clientId: ${clientId}`);

    // Persiste clientId dans Redis avec le même TTL que la session
    await redisClient.setEx(
      `titan-agent:meta:${sessionId}`,
      env.SESSION_TTL_SECONDS,
      JSON.stringify({ clientId })
    );

    // Envoie l'historique existant si le client se reconnecte avant expiration du TTL
    try {
      const history = getSessionHistory(sessionId);
      const pastMessages = await history.getMessages();

      if (pastMessages.length > 0) {
        const formatted = pastMessages.map((m) => ({
          role: m._getType() === "human" ? "user" : "agent",
          text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
        socket.emit("chat:history", { messages: formatted });
        console.log(`📜 Historique envoyé — ${formatted.length} messages pour sessionId: ${sessionId}`);
      }
    } catch (err) {
      console.error("Erreur lors de la récupération de l'historique:", err);
    }

    // Écoute les messages entrants
    socket.on("chat:message", async (data: { text: string }) => {
      const userMessage = data?.text?.trim();
      if (!userMessage) return;

      console.log(`💬 [${sessionId}] User: ${userMessage}`);
      socket.emit("chat:typing", { typing: true });

      try {
        const result = await agentWithHistory.invoke(
          { input: userMessage },
          { configurable: { sessionId } }
        );

        const reply = result.output as string;
        console.log(`🤖 [${sessionId}] Agent: ${reply}`);

        socket.emit("chat:typing", { typing: false });
        socket.emit("chat:reply", { text: reply, sessionId });
      } catch (err) {
        console.error(`Erreur agent [${sessionId}]:`, err);
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
