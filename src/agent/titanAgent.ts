import { ChatAnthropic } from "@langchain/anthropic";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { env } from "../config/env.js";
import { getTrimmedHistory, appendToHistory } from "../memory/sessionMemory.js";
import { searchFaqTool } from "./tools/searchFaq.tool.js";
import { searchKnowledgeBaseTool } from "./tools/searchKnowledgeBase.tool.js";
import { createTicketTool } from "./tools/createTicket.tool.js";
import { startTimerTool } from "./tools/startTimer.tool.js";
import { TITAN_SYSTEM_PROMPT } from "./prompt.js";
import { parseTitanReplyToPlainText, titanStructuredOutputParser } from "./titanReplyParse.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.3,
  maxTokens: 1024,
});

const tools = [searchFaqTool, searchKnowledgeBaseTool, createTicketTool, startTimerTool];

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `${TITAN_SYSTEM_PROMPT}

Réponds au format JSON attendu par le système (voir ci-dessous). Tu peux utiliser soit du JSON brut, soit un bloc Markdown \`\`\`json ... \`\`\` comme dans les instructions.

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

async function normalizeAgentText(raw: unknown): Promise<string> {
  const asText = contentToText(raw).trim();
  if (!asText) return "";
  return parseTitanReplyToPlainText(asText);
}

export async function invokeSupportAgent(input: string, sessionId: string): Promise<string> {
  const chatHistory = await getTrimmedHistory(sessionId);

  const result = await executor.invoke({
    input,
    chat_history: chatHistory,
    format_instructions: titanStructuredOutputParser.getFormatInstructions(),
  });

  const raw = (result as { output?: unknown; text?: unknown }).output ?? (result as { text?: unknown }).text ?? result;
  const text = await normalizeAgentText(raw);
  const finalText = text || "Je n'ai pas pu générer une réponse pour le moment.";

  try {
    await appendToHistory(sessionId, input, finalText);
  } catch (err) {
    console.warn(`[history] Erreur sauvegarde [${sessionId}]:`, err);
  }

  return finalText;
}
