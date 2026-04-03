import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  END,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, BaseMessage, AIMessage } from "@langchain/core/messages";
import { searchFaqTool } from "./tools/searchFaq.tool.js";
import { searchKnowledgeBaseTool } from "./tools/searchKnowledgeBase.tool.js";
import { createTicketTool } from "./tools/createTicket.tool.js";
import { startTimerTool } from "./tools/startTimer.tool.js";
import { TITAN_SYSTEM_PROMPT } from "./prompt.js";
import { env } from "../config/env.js";

const tools = [searchFaqTool, searchKnowledgeBaseTool, createTicketTool, startTimerTool];

// Annotations de type explicites pour éviter l'inférence récursive de tsc
const model: ReturnType<ChatAnthropic["bindTools"]> = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.3,
  maxTokens: 1024,
}).bindTools(tools);

// Type explicite de la valeur de retour du nœud agent
type AgentNodeReturn = { messages: AIMessage[] };

async function agentNode(
  state: { messages: BaseMessage[] }
): Promise<AgentNodeReturn> {
  const messages: BaseMessage[] = [
    new SystemMessage(TITAN_SYSTEM_PROMPT),
    ...state.messages,
  ];
  const response = await model.invoke(messages) as AIMessage;
  return { messages: [response] };
}

const toolNode = new ToolNode(tools);

// Type de retour explicite pour la fonction de routage
function routeAfterAgent(
  state: { messages: BaseMessage[] }
): "tools" | typeof END {
  // toolsCondition retourne "tools" si le dernier message contient des tool_calls, sinon END
  return toolsCondition(state as Parameters<typeof toolsCondition>[0]);
}

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", routeAfterAgent)
  .addEdge("tools", "agent");

export const checkpointer = new MemorySaver();
export const graph = workflow.compile({ checkpointer });
