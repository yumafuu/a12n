import { z } from "zod";
import * as db from "../lib/db.js";
import { MessageType } from "../types.js";
import type { Message } from "../types.js";
import { getSocketClient } from "../lib/socket.js";

// Queue for messages received via socket
const socketMessageQueue: Message[] = [];

// Setup socket message handler
export function setupSocketMessageHandler(): void {
  const socketClient = getSocketClient("reviewer", "reviewer");
  socketClient.onMessage((message) => {
    // Queue messages for reviewer
    if (message.to === "reviewer") {
      socketMessageQueue.push(message);
    }
  });
}

// Tool definitions for reviewer
export const reviewerTools = [
  {
    name: "check_messages",
    description:
      "Check for review requests from orchestrator. Call this regularly.",
    inputSchema: z.object({}),
  },
  {
    name: "send_review_result",
    description: "Send review result back to orchestrator",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID"),
      approved: z.boolean().describe("Whether the PR is approved"),
      feedback: z.string().optional().describe("Feedback for the worker"),
    }),
  },
  {
    name: "get_task_info",
    description: "Get detailed information about a task",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID to get info for"),
    }),
  },
] as const;

// Tool handlers
export const reviewerHandlers = {
  async check_messages(): Promise<string> {
    // First, check socket queue for real-time messages
    const socketMessages = socketMessageQueue.splice(0);

    // Also check database for any missed messages (fallback)
    // Use "reviewer" as reader_id - messages are marked as read automatically
    const { messages: dbMessages } = await db.checkMessages("reviewer", "reviewer");

    // Merge and dedupe messages
    const messageMap = new Map<string, Message>();
    for (const msg of dbMessages) {
      messageMap.set(msg.id, msg);
    }
    for (const msg of socketMessages) {
      messageMap.set(msg.id, msg);
    }
    const allMessages = Array.from(messageMap.values());

    // Filter for REVIEW_REQUEST messages only
    const reviewRequests = allMessages.filter(
      (m) => m.type === MessageType.REVIEW_REQUEST
    );

    return JSON.stringify({
      success: true,
      messages: reviewRequests.map((m) => ({
        id: m.id,
        from: m.from,
        type: m.type,
        payload: m.payload,
        timestamp: new Date(m.timestamp).toISOString(),
      })),
      count: reviewRequests.length,
    });
  },

  async send_review_result(params: {
    task_id: string;
    approved: boolean;
    feedback?: string;
  }): Promise<string> {
    // Send review result to orche
    const messageId = await db.sendMessage(
      "orche",
      "reviewer",
      MessageType.REVIEW_RESULT,
      {
        task_id: params.task_id,
        approved: params.approved,
        feedback: params.feedback,
      }
    );

    // Also notify planner about review completion
    await db.sendMessage(
      "planner",
      "reviewer",
      MessageType.PROGRESS,
      {
        task_id: params.task_id,
        status: params.approved ? "APPROVED" : "NEEDS_REVISION",
        message: params.approved
          ? `Task ${params.task_id} approved. PR will be merged.`
          : `Task ${params.task_id} needs revision: ${params.feedback}`,
      }
    );

    return JSON.stringify({
      success: true,
      message_id: messageId,
      message: params.approved
        ? `Task ${params.task_id} approved`
        : `Task ${params.task_id} needs revision`,
    });
  },

  async get_task_info(params: { task_id: string }): Promise<string> {
    const task = await db.getTask(params.task_id);

    if (!task) {
      return JSON.stringify({
        success: false,
        error: `Task ${params.task_id} not found`,
      });
    }

    return JSON.stringify({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        description: task.description,
        context: task.context,
        pr_url: task.pr_url,
        worker_id: task.worker_id,
        created_at: new Date(task.created_at).toISOString(),
        updated_at: new Date(task.updated_at).toISOString(),
      },
    });
  },
};
