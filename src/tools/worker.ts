import { z } from "zod";
import * as redis from "../lib/redis.js";
import { MessageType, TaskStatus } from "../types.js";

// Get worker ID from environment
function getWorkerId(): string {
  const workerId = process.env.WORKER_ID;
  if (!workerId) {
    throw new Error("WORKER_ID environment variable is not set");
  }
  return workerId;
}

// Get task ID from environment
function getTaskId(): string {
  const taskId = process.env.TASK_ID;
  if (!taskId) {
    throw new Error("TASK_ID environment variable is not set");
  }
  return taskId;
}

// Tool definitions for worker
export const workerTools = [
  {
    name: "check_messages",
    description:
      "Check for messages from orchestrator. Call this regularly to receive instructions. Also updates heartbeat.",
    inputSchema: z.object({
      last_id: z
        .string()
        .optional()
        .describe("Last message ID (for pagination)"),
    }),
  },
  {
    name: "send_message",
    description: "Send a message to the orchestrator",
    inputSchema: z.object({
      type: z
        .enum(["PROGRESS", "QUESTION", "REVIEW_REQUEST"])
        .describe("Message type"),
      payload: z.string().describe("Message payload as JSON string"),
    }),
  },
  {
    name: "update_progress",
    description: "Update task progress for dashboard visibility",
    inputSchema: z.object({
      status: z.string().describe("Current status description"),
      message: z.string().describe("Progress message"),
    }),
  },
] as const;

// Store last message ID for pagination
let lastMessageId = "0";

// Tool handlers
export const workerHandlers = {
  async check_messages(params: { last_id?: string }): Promise<string> {
    const workerId = getWorkerId();

    // Update heartbeat
    await redis.updateWorkerHeartbeat(workerId);

    // Check messages
    const { messages, lastId } = await redis.checkMessages(
      workerId,
      params.last_id || lastMessageId
    );

    // Update stored last ID
    lastMessageId = lastId;

    // Check for TASK_COMPLETE message
    const completeMessage = messages.find(
      (m) => m.type === MessageType.TASK_COMPLETE
    );

    if (completeMessage) {
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
        should_terminate: true,
        terminate_reason: "TASK_COMPLETE received. Your task is done. You should stop working now.",
      });
    }

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
      should_terminate: false,
    });
  },

  async send_message(params: {
    type: "PROGRESS" | "QUESTION" | "REVIEW_REQUEST";
    payload: string;
  }): Promise<string> {
    const workerId = getWorkerId();
    const taskId = getTaskId();

    // Update heartbeat
    await redis.updateWorkerHeartbeat(workerId);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(params.payload);
    } catch {
      return JSON.stringify({
        success: false,
        error: "Invalid JSON payload",
      });
    }

    // Add task_id to payload if not present
    if (!payload.task_id) {
      payload.task_id = taskId;
    }

    const messageId = await redis.sendMessage(
      "orche",
      workerId,
      params.type as MessageType,
      payload as never
    );

    // Update task status if sending review request
    if (params.type === "REVIEW_REQUEST") {
      await redis.updateTaskStatus(taskId, TaskStatus.REVIEW);
    }

    return JSON.stringify({
      success: true,
      message_id: messageId,
      message: `Message sent to orchestrator`,
    });
  },

  async update_progress(params: {
    status: string;
    message: string;
  }): Promise<string> {
    const workerId = getWorkerId();
    const taskId = getTaskId();

    // Update heartbeat
    await redis.updateWorkerHeartbeat(workerId);

    // Send progress message
    const messageId = await redis.sendMessage(
      "orche",
      workerId,
      MessageType.PROGRESS,
      {
        task_id: taskId,
        status: params.status,
        message: params.message,
      }
    );

    return JSON.stringify({
      success: true,
      message_id: messageId,
      message: `Progress updated: ${params.status}`,
    });
  },
};
