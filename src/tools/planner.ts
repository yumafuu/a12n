import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import * as db from "../lib/db.js";
import { EventType } from "../types.js";
import type { TaskCreateEventPayload } from "../types.js";
import * as memory from "../lib/memory.js";
import { MemoryCategory } from "../lib/memory.js";

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
  {
    name: "read_memory",
    description: "Read knowledge from a specific memory category",
    inputSchema: z.object({
      category: z
        .enum([
          "architecture",
          "tech-stack",
          "requirements",
          "decisions",
          "conventions",
        ])
        .describe("Memory category to read"),
    }),
  },
  {
    name: "write_memory",
    description: "Write or update knowledge in a specific memory category",
    inputSchema: z.object({
      category: z
        .enum([
          "architecture",
          "tech-stack",
          "requirements",
          "decisions",
          "conventions",
        ])
        .describe("Memory category to write"),
      content: z.string().describe("Content to write (will overwrite existing content)"),
    }),
  },
  {
    name: "append_memory",
    description: "Append knowledge to a specific memory category without overwriting",
    inputSchema: z.object({
      category: z
        .enum([
          "architecture",
          "tech-stack",
          "requirements",
          "decisions",
          "conventions",
        ])
        .describe("Memory category to append to"),
      content: z.string().describe("Content to append"),
    }),
  },
  {
    name: "list_memories",
    description: "List all memory categories and check if they have content",
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

  async read_memory(params: { category: string }): Promise<string> {
    try {
      const content = await memory.readMemory(params.category as MemoryCategory);

      return JSON.stringify({
        success: true,
        category: params.category,
        content: content,
        has_content: content.trim().length > 0,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  },

  async write_memory(params: {
    category: string;
    content: string;
  }): Promise<string> {
    try {
      await memory.writeMemory(params.category as MemoryCategory, params.content);

      return JSON.stringify({
        success: true,
        category: params.category,
        message: `Memory written to ${params.category}`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  },

  async append_memory(params: {
    category: string;
    content: string;
  }): Promise<string> {
    try {
      await memory.appendMemory(params.category as MemoryCategory, params.content);

      return JSON.stringify({
        success: true,
        category: params.category,
        message: `Memory appended to ${params.category}`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  },

  async list_memories(): Promise<string> {
    try {
      const categories = Object.values(MemoryCategory);
      const memories = await Promise.all(
        categories.map(async (category) => ({
          category,
          has_content: await memory.hasMemory(category),
        }))
      );

      return JSON.stringify({
        success: true,
        memories,
        count: memories.length,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  },
};
