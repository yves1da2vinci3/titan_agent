import { ChatAnthropic } from "@langchain/anthropic";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { env } from "../config/env";
import { getSessionHistory } from "../memory/sessionMemory";
import { searchFaqTool } from "./tools/searchFaq.tool";
import { createTicketTool } from "./tools/createTicket.tool";
import { TITAN_SYSTEM_PROMPT } from "./prompt";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.3,
  maxTokens: 1024,
});

const tools = [searchFaqTool, createTicketTool];

const prompt = ChatPromptTemplate.fromMessages([
  ["system", TITAN_SYSTEM_PROMPT],
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

export const agentWithHistory = new RunnableWithMessageHistory({
  runnable: executor,
  getMessageHistory: (sessionId: string) => getSessionHistory(sessionId),
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history",
});
