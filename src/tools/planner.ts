import { z } from "zod";
import * as db from "../lib/db.js";
import { MessageType } from "../types.js";
import type { Message } from "../types.js";
import { getSocketClient } from "../lib/socket.js";

// Queue for messages received via socket
const socketMessageQueue: Message[] = [];

// Setup socket message handler
export function setupSocketMessageHandler(): void {
  const socketClient = getSocketClient("planner", "planner");
  socketClient.onMessage((message) => {
    // Queue messages for planner
    if (message.to === "planner") {
      socketMessageQueue.push(message);
    }
  });
}

// Tool definitions for planner
export const plannerTools = [
  {
    name: "send_task_to_orche",
    description: "Send a task to orchestrator for execution",
    inputSchema: z.object({
      description: z.string().describe("Clear and specific task description"),
      context: z.string().optional().describe("Additional context for the task"),
    }),
  },
  {
    name: "check_messages",
    description: "Check for messages from orchestrator (task status, completion reports)",
    inputSchema: z.object({
      last_id: z
        .string()
        .optional()
        .describe("Last message ID (for pagination)"),
    }),
  },
  {
    name: "list_tasks",
    description: "List all tasks and their status",
    inputSchema: z.object({}),
  },
] as const;

// Store last message ID for pagination
let lastMessageId = "0";

// Tool handlers
export const plannerHandlers = {
  async send_task_to_orche(params: {
    description: string;
    context?: string;
  }): Promise<string> {
    // Send task to orche
    const messageId = await db.sendMessage(
      "orche",
      "planner",
      MessageType.TASK_ASSIGN,
      {
        task_id: "", // orche will generate
        description: params.description,
        context: params.context,
      }
    );

    return JSON.stringify({
      success: true,
      message_id: messageId,
      message: `Task sent to orchestrator: ${params.description}`,
    });
  },

  async check_messages(params: { last_id?: string }): Promise<string> {
    // First, check socket queue for real-time messages
    const socketMessages = socketMessageQueue.splice(0);

    // Also check database for any missed messages (fallback)
    const { messages: dbMessages, lastId } = await db.checkMessages(
      "planner",
      params.last_id || lastMessageId
    );

    lastMessageId = lastId;

    // Merge and dedupe messages
    const messageMap = new Map<string, Message>();
    for (const msg of dbMessages) {
      messageMap.set(msg.id, msg);
    }
    for (const msg of socketMessages) {
      messageMap.set(msg.id, msg);
    }
    const allMessages = Array.from(messageMap.values());

    return JSON.stringify({
      success: true,
      messages: allMessages.map((m) => ({
        id: m.id,
        from: m.from,
        type: m.type,
        payload: m.payload,
        timestamp: new Date(m.timestamp).toISOString(),
      })),
      last_id: lastId,
      count: allMessages.length,
    });
  },

  async list_tasks(): Promise<string> {
    const tasks = await db.listAllTasks();

    return JSON.stringify({
      success: true,
      tasks: tasks.map((t) => ({
        id: t.id,
        status: t.status,
        worker_id: t.worker_id,
        description: t.description,
        pr_url: t.pr_url,
        created_at: new Date(t.created_at).toISOString(),
        updated_at: new Date(t.updated_at).toISOString(),
      })),
      count: tasks.length,
    });
  },
};
