import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import * as db from "../lib/db.js";
import { EventType } from "../types.js";
import type { TaskCreateEventPayload } from "../types.js";

// Tool definitions for planner
export const plannerTools = [
  {
    name: "send_task_to_orche",
    description: "Send a task to orchestrator for execution",
    inputSchema: z.object({
      description: z.string().describe("Clear and specific task description"),
      context: z.string().optional().describe("Additional context for the task"),
      branch_name: z.string().optional().describe("Custom branch name (e.g., 'feat/add-user-auth'). If not specified, defaults to 'task/{taskId}'"),
    }),
  },
  {
    name: "check_messages",
    description: "Check for messages from orchestrator (task status, completion reports)",
    inputSchema: z.object({}),
  },
  {
    name: "list_tasks",
    description: "List all tasks and their status",
    inputSchema: z.object({}),
  },
] as const;

// Tool handlers
export const plannerHandlers = {
  async send_task_to_orche(params: {
    description: string;
    context?: string;
    branch_name?: string;
  }): Promise<string> {
    // Generate task ID and branch name
    const taskId = uuidv4();
    const branchName = params.branch_name || `task/${taskId.slice(0, 8)}`;

    // Register task-create event
    const payload: TaskCreateEventPayload = {
      task_id: taskId,
      description: params.description,
      context: params.context,
      branch_name: branchName,
    };

    const eventId = await db.registerEvent(
      EventType.TASK_CREATE,
      taskId,
      payload
    );

    return JSON.stringify({
      success: true,
      event_id: eventId,
      task_id: taskId,
      message: `Task created: ${params.description}`,
    });
  },

  async check_messages(): Promise<string> {
    // Legacy method - kept for backward compatibility
    // In event-driven architecture, planner doesn't receive messages
    return JSON.stringify({
      success: true,
      messages: [],
      count: 0,
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
