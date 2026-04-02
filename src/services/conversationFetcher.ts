import { env } from "../config/env.js";

export type ArchivedMessage = {
  role: "user" | "agent";
  text: string;
};

type ServerMessage = {
  role: string;
  content: string;
};

type ServerConversation = {
  messages?: ServerMessage[];
};

/**
 * Fetches an archived conversation from the server's PostgreSQL by sessionId.
 * Returns messages formatted for chat:history emission, or null if not found.
 */
export async function fetchArchivedConversation(
  sessionId: string,
): Promise<ArchivedMessage[] | null> {
  if (!env.SERVER_URL || !env.AGENT_INTERNAL_SECRET) {
    return null;
  }

  try {
    const response = await fetch(
      `${env.SERVER_URL}/internal/conversations/session/${encodeURIComponent(sessionId)}`,
      {
        headers: {
          "X-Agent-Secret": env.AGENT_INTERNAL_SECRET,
        },
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      console.error(`[conversationFetcher] Erreur serveur ${response.status}`);
      return null;
    }

    const conv = (await response.json()) as ServerConversation;
    if (!conv.messages || conv.messages.length === 0) {
      return null;
    }

    return conv.messages.map((m) => ({
      role: (m.role === "user" ? "user" : "agent") as "user" | "agent",
      text: m.content,
    }));
  } catch (err) {
    console.error("[conversationFetcher] Erreur réseau:", err);
    return null;
  }
}
