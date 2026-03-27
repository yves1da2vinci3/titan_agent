import { AsyncLocalStorage } from "async_hooks";

/**
 * Stores the current sessionId for the duration of an agent invocation.
 * Tools (e.g. createTicket) can read it without needing the AI to pass it.
 */
export const sessionStorage = new AsyncLocalStorage<string>();
