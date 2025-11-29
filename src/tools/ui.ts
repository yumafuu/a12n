import { z } from "zod";
import * as db from "../lib/db.js";
import { MessageType } from "../types.js";

// Tool definitions for UI (human interaction)
export const uiTools = [
  {
    name: "send_task",
    description:
      "Send a task request to the Planner. Use this when the human wants something done.",
    inputSchema: z.object({
      description: z.string().describe("Task description from the human"),
      context: z.string().optional().describe("Additional context"),
    }),
  },
  {
    name: "ask_status",
    description:
      "Ask the Planner for the current status of all tasks. Use this when the human wants to know progress.",
    inputSchema: z.object({}),
  },
  {
    name: "check_responses",
    description:
      "Check for responses from the Planner. Call this to see if there are any updates.",
    inputSchema: z.object({
      last_id: z
        .string()
        .optional()
        .describe("Last message ID (for pagination)"),
    }),
  },
  {
    name: "send_feedback",
    description:
      "Send feedback or additional instructions to the Planner about an ongoing task.",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID to send feedback about"),
      message: z.string().describe("Feedback or instructions"),
    }),
  },
] as const;

// Store last message ID for pagination
let lastMessageId = "0";

// Tool handlers
export const uiHandlers = {
  async send_task(params: {
    description: string;
    context?: string;
  }): Promise<string> {
    // Send task request to planner
    const messageId = await db.sendMessage(
      "planner",
      "ui",
      MessageType.TASK_ASSIGN,
      {
        task_id: "", // Planner will assign
        description: params.description,
        context: params.context,
      }
    );

    return JSON.stringify({
      success: true,
      message_id: messageId,
      message: "Task sent to Planner. They will handle it from here.",
    });
  },

  async ask_status(): Promise<string> {
    // Get all tasks
    const tasks = await db.listAllTasks();

    if (tasks.length === 0) {
      return JSON.stringify({
        success: true,
        tasks: [],
        message: "No tasks found.",
      });
    }

    return JSON.stringify({
      success: true,
      tasks: tasks.map((t) => ({
        id: t.id,
        status: t.status,
        description: t.description,
        pr_url: t.pr_url,
        updated_at: new Date(t.updated_at).toISOString(),
      })),
      summary: `${tasks.length} task(s) found. Status: ${tasks.map((t) => `${t.id}: ${t.status}`).join(", ")}`,
    });
  },

  async check_responses(params: { last_id?: string }): Promise<string> {
    // Check messages from planner
    const { messages, lastId } = await db.checkMessages(
      "ui",
      params.last_id || lastMessageId
    );

    // Update stored last ID
    lastMessageId = lastId;

    return JSON.stringify({
      success: true,
      messages: messages.map((m) => ({
        id: m.id,
        from: m.from,
        type: m.type,
        payload: m.payload,
        timestamp: new Date(m.timestamp).toISOString(),
      })),
      last_id: lastId,
      count: messages.length,
    });
  },

  async send_feedback(params: {
    task_id: string;
    message: string;
  }): Promise<string> {
    // Send feedback to planner
    const messageId = await db.sendMessage(
      "planner",
      "ui",
      MessageType.QUESTION,
      {
        task_id: params.task_id,
        question: params.message,
      }
    );

    return JSON.stringify({
      success: true,
      message_id: messageId,
      message: "Feedback sent to Planner.",
    });
  },
};
