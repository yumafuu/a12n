import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import * as db from "../lib/db.js";
import * as tmux from "../lib/tmux.js";
import { MessageType, TaskStatus } from "../types.js";

// Tool definitions for orchestrator
export const orcheTools = [
  {
    name: "spawn_worker",
    description:
      "Create a new tmux pane and spawn a worker Claude CLI with a task",
    inputSchema: z.object({
      task_id: z
        .string()
        .optional()
        .describe("Task ID (auto-generated if not provided)"),
      description: z.string().describe("Task description for the worker"),
      context: z.string().optional().describe("Additional context for the task"),
    }),
  },
  {
    name: "kill_worker",
    description: "Terminate a worker and its tmux pane",
    inputSchema: z.object({
      worker_id: z.string().describe("Worker ID to terminate"),
    }),
  },
  {
    name: "list_workers",
    description: "List all active workers and their status",
    inputSchema: z.object({}),
  },
  {
    name: "send_message",
    description: "Send a message to a specific worker",
    inputSchema: z.object({
      worker_id: z.string().describe("Target worker ID"),
      type: z
        .enum(["ANSWER", "REVIEW_RESULT", "TASK_COMPLETE"])
        .describe("Message type"),
      payload: z.string().describe("Message payload as JSON string"),
    }),
  },
  {
    name: "check_messages",
    description: "Check for messages from workers",
    inputSchema: z.object({
      last_id: z
        .string()
        .optional()
        .describe("Last message ID (for pagination)"),
    }),
  },
  {
    name: "complete_task",
    description: "Mark a task as complete and notify the worker to terminate",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID to complete"),
    }),
  },
  {
    name: "get_task_status",
    description: "Get the current status of a task",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID to check"),
    }),
  },
] as const;

// Get project root directory
function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

// Tool handlers
export const orcheHandlers = {
  async spawn_worker(params: {
    task_id?: string;
    description: string;
    context?: string;
  }): Promise<string> {
    const taskId = params.task_id || uuidv4();
    const workerId = `worker-${uuidv4().slice(0, 8)}`;
    const projectRoot = getProjectRoot();

    // Create task in Redis
    await db.createTask(taskId, params.description, params.context);

    // Create new tmux pane
    const workerConfigPath = `${projectRoot}/worker.json`;
    const workerPromptPath = `${projectRoot}/worker-prompt.md`;
    const command = `WORKER_ID=${workerId} TASK_ID=${taskId} claude --mcp-config ${workerConfigPath} --system-prompt "$(cat ${workerPromptPath})" "タスクを開始してください。まず check_messages を呼んでタスク内容を確認してください。"`;

    const paneId = await tmux.splitPane("horizontal", command);

    // Register worker
    await db.registerWorker(workerId, paneId);
    await db.updateWorkerStatus(workerId, "running", taskId);
    await db.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS, workerId);

    // Send initial task assignment message
    await db.sendMessage(workerId, "orche", MessageType.TASK_ASSIGN, {
      task_id: taskId,
      description: params.description,
      context: params.context,
    });

    return JSON.stringify({
      success: true,
      worker_id: workerId,
      task_id: taskId,
      pane_id: paneId,
      message: `Worker ${workerId} spawned with task ${taskId}`,
    });
  },

  async kill_worker(params: { worker_id: string }): Promise<string> {
    const worker = await db.getWorker(params.worker_id);

    if (!worker) {
      return JSON.stringify({
        success: false,
        error: `Worker ${params.worker_id} not found`,
      });
    }

    // Kill tmux pane if exists
    if (worker.pane_id) {
      try {
        await tmux.killPane(worker.pane_id);
      } catch {
        // Pane might already be closed
      }
    }

    // Update task status if worker had a task
    if (worker.task_id) {
      await db.updateTaskStatus(worker.task_id, TaskStatus.FAILED);
    }

    // Remove worker from Redis
    await db.removeWorker(params.worker_id);

    return JSON.stringify({
      success: true,
      message: `Worker ${params.worker_id} terminated`,
    });
  },

  async list_workers(): Promise<string> {
    const workers = await db.listActiveWorkers();

    if (workers.length === 0) {
      return JSON.stringify({
        success: true,
        workers: [],
        message: "No active workers",
      });
    }

    const workerList = await Promise.all(
      workers.map(async (w) => {
        const task = w.task_id ? await db.getTask(w.task_id) : null;
        return {
          id: w.id,
          status: w.status,
          task_id: w.task_id,
          task_status: task?.status,
          task_description: task?.description,
          pane_id: w.pane_id,
          last_heartbeat: new Date(w.last_heartbeat).toISOString(),
        };
      })
    );

    return JSON.stringify({
      success: true,
      workers: workerList,
      count: workerList.length,
    });
  },

  async send_message(params: {
    worker_id: string;
    type: "ANSWER" | "REVIEW_RESULT" | "TASK_COMPLETE";
    payload: string;
  }): Promise<string> {
    const worker = await db.getWorker(params.worker_id);

    if (!worker) {
      return JSON.stringify({
        success: false,
        error: `Worker ${params.worker_id} not found`,
      });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(params.payload);
    } catch {
      return JSON.stringify({
        success: false,
        error: "Invalid JSON payload",
      });
    }

    const messageId = await db.sendMessage(
      params.worker_id,
      "orche",
      params.type as MessageType,
      payload as never
    );

    // Update task status based on message type
    if (params.type === "REVIEW_RESULT" && worker.task_id) {
      const reviewPayload = payload as { approved?: boolean };
      if (!reviewPayload.approved) {
        await db.updateTaskStatus(worker.task_id, TaskStatus.IN_PROGRESS);
      }
    }

    return JSON.stringify({
      success: true,
      message_id: messageId,
      message: `Message sent to ${params.worker_id}`,
    });
  },

  async check_messages(params: { last_id?: string }): Promise<string> {
    const { messages, lastId } = await db.checkMessages(
      "orche",
      params.last_id || "0"
    );

    // Update task status based on received messages
    for (const msg of messages) {
      if (msg.type === MessageType.REVIEW_REQUEST) {
        const payload = msg.payload as { task_id: string };
        await db.updateTaskStatus(payload.task_id, TaskStatus.REVIEW);
      }
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
    });
  },

  async complete_task(params: { task_id: string }): Promise<string> {
    const task = await db.getTask(params.task_id);

    if (!task) {
      return JSON.stringify({
        success: false,
        error: `Task ${params.task_id} not found`,
      });
    }

    if (!task.worker_id) {
      return JSON.stringify({
        success: false,
        error: `Task ${params.task_id} has no assigned worker`,
      });
    }

    // Send completion message to worker
    await db.sendMessage(task.worker_id, "orche", MessageType.TASK_COMPLETE, {
      task_id: params.task_id,
    });

    // Update task status
    await db.updateTaskStatus(params.task_id, TaskStatus.COMPLETED);

    // Kill worker pane
    const worker = await db.getWorker(task.worker_id);
    if (worker?.pane_id) {
      try {
        await tmux.killPane(worker.pane_id);
      } catch {
        // Pane might already be closed
      }
    }

    // Remove worker from db
    await db.removeWorker(task.worker_id);

    return JSON.stringify({
      success: true,
      message: `Task ${params.task_id} completed. Worker ${task.worker_id} terminated.`,
    });
  },

  async get_task_status(params: { task_id: string }): Promise<string> {
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
        worker_id: task.worker_id,
        description: task.description,
        context: task.context,
        created_at: new Date(task.created_at).toISOString(),
        updated_at: new Date(task.updated_at).toISOString(),
      },
    });
  },
};
