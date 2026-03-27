import { ChatAnthropic } from "@langchain/anthropic";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { env } from "../config/env";
import { getTrimmedHistory, appendToHistory } from "../memory/sessionMemory";
import { searchFaqTool } from "./tools/searchFaq.tool";
import { createTicketTool } from "./tools/createTicket.tool";
import { startTimerTool } from "./tools/startTimer.tool";
import { TITAN_SYSTEM_PROMPT } from "./prompt";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.3,
  maxTokens: 1024,
});

const tools = [searchFaqTool, createTicketTool, startTimerTool];

const TitanChatReplySchema = z.object({
  text: z.string(),
});
type TitanChatReply = z.infer<typeof TitanChatReplySchema>;

const outputParser = StructuredOutputParser.fromZodSchema(TitanChatReplySchema);

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `${TITAN_SYSTEM_PROMPT}

Tu dois répondre au format JSON uniquement, avec exactement cette forme:
{{"text": "..."}}

{format_instructions}`,
  ],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
  new MessagesPlaceholder("agent_scratchpad"),
]);

const agent = createToolCallingAgent({ llm, tools, prompt });

const executor = new AgentExecutor({
  agent,
  tools,
  verbose: false,
  maxIterations: 5,
});

function contentToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    return contentToText((value as { content: unknown }).content);
  }
  if (Array.isArray(value)) {
    return value
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object" && "text" in b) return String((b as { text: unknown }).text);
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeAgentText(raw: unknown): string {
  const asText = contentToText(raw).trim();
  if (!asText) return "";

  try {
    const maybeJson = JSON.parse(asText) as unknown;
    const validated = TitanChatReplySchema.safeParse(maybeJson);
    if (validated.success) return validated.data.text.trim();
  } catch {
    // not JSON; continue with parser fallback
  }

  return asText;
}

export async function invokeSupportAgent(input: string, sessionId: string): Promise<string> {
  // Load conversation history manually (avoids RunnableWithMessageHistory serialization issues)
  const chatHistory = await getTrimmedHistory(sessionId);

  const result = await executor.invoke({
    input,
    chat_history: chatHistory,
    format_instructions: outputParser.getFormatInstructions(),
  });

  const raw = (result as { output?: unknown; text?: unknown }).output ?? (result as { text?: unknown }).text ?? result;
  const text = normalizeAgentText(raw);
  const finalText = text || "Je n'ai pas pu générer une réponse pour le moment.";

  // Save to history manually — only simple HumanMessage + AIMessage (no tool calls)
  try {
    await appendToHistory(sessionId, input, finalText);
  } catch (err) {
    console.warn(`[history] Erreur sauvegarde [${sessionId}]:`, err);
  }

  return finalText;
}
