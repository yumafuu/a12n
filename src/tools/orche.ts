import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import * as db from "../lib/db.js";
import * as tmux from "../lib/tmux.js";
import { setWindowStyle, setWindowName } from "../lib/tmux.js";
import { MessageType, TaskStatus } from "../types.js";
import type { Message } from "../types.js";
import { getSocketServer } from "../lib/socket.js";

// Queue for messages received via socket
const socketMessageQueue: Message[] = [];

// Setup socket message handler for orche
export function setupSocketMessageHandler(): void {
  const socketServer = getSocketServer();
  socketServer.onMessage((message) => {
    // Queue messages for orche
    if (message.to === "orche") {
      socketMessageQueue.push(message);
    }
  });
}

// Tool definitions for orchestrator
export const orcheTools = [
  {
    name: "spawn_worker",
    description:
      "Create a new tmux window and spawn a worker Claude CLI with a task",
    inputSchema: z.object({
      task_id: z
        .string()
        .optional()
        .describe("Task ID (auto-generated if not provided)"),
      description: z.string().describe("Task description for the worker"),
      context: z.string().optional().describe("Additional context for the task"),
      branch_name: z.string().optional().describe("Custom branch name (e.g., 'feat/add-user-auth'). If not specified, defaults to 'task/{taskId}'"),
    }),
  },
  {
    name: "kill_worker",
    description: "Terminate a worker and its tmux window",
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
    inputSchema: z.object({}),
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
  {
    name: "emergency_stop",
    description:
      "Emergency stop a worker that is performing dangerous operations. Use this when you detect risky commands like rm -rf, force push to main, etc.",
    inputSchema: z.object({
      worker_id: z.string().describe("Worker ID to stop"),
      reason: z.string().describe("Reason for emergency stop"),
    }),
  },
] as const;

// Get project root directory
function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

// Get target repository root (where workers will work)
function getTargetRepoRoot(): string {
  return process.env.TARGET_REPO_ROOT || process.cwd();
}

// Get the default branch name (main or master)
async function getDefaultBranch(targetRepo: string): Promise<string> {
  // Try to get the default branch from remote
  const proc = Bun.spawn(
    ["git", "symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    {
      cwd: targetRepo,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const output = (await new Response(proc.stdout).text()).trim();
  await proc.exited;

  if (output) {
    // Output is like "origin/main", extract branch name
    return output.replace("origin/", "");
  }

  // Fallback: check if main or master exists
  const mainProc = Bun.spawn(
    ["git", "rev-parse", "--verify", "origin/main"],
    {
      cwd: targetRepo,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const mainExitCode = await mainProc.exited;
  if (mainExitCode === 0) {
    return "main";
  }

  return "master";
}

// Create git worktree for a worker
async function createWorktree(
  taskId: string,
  workerId: string,
  customBranchName?: string
): Promise<{ worktreePath: string; branchName: string }> {
  const targetRepo = getTargetRepoRoot();
  const branchName = customBranchName || `task/${taskId.slice(0, 8)}`;
  const worktreePath = `${targetRepo}/.worktrees/${workerId}`;

  // Create .worktrees directory if it doesn't exist
  const proc1 = Bun.spawn(["mkdir", "-p", `${targetRepo}/.worktrees`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc1.exited;

  // Get the default branch (main or master)
  const defaultBranch = await getDefaultBranch(targetRepo);

  // Fetch the latest changes from remote for the default branch
  const fetchProc = Bun.spawn(
    ["git", "fetch", "origin", defaultBranch],
    {
      cwd: targetRepo,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  await fetchProc.exited;

  // Create new worktree with new branch based on latest origin/defaultBranch
  const proc3 = Bun.spawn(
    ["git", "worktree", "add", "-b", branchName, worktreePath, `origin/${defaultBranch}`],
    {
      cwd: targetRepo,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const stderr = await new Response(proc3.stderr).text();
  const exitCode = await proc3.exited;

  if (exitCode !== 0) {
    // Branch might already exist, try without -b
    const proc4 = Bun.spawn(
      ["git", "worktree", "add", worktreePath, branchName],
      {
        cwd: targetRepo,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc4.exited;
  }

  return { worktreePath, branchName };
}

// Remove git worktree
async function removeWorktree(worktreePath: string): Promise<void> {
  const targetRepo = getTargetRepoRoot();

  // Remove worktree
  const proc = Bun.spawn(["git", "worktree", "remove", "--force", worktreePath], {
    cwd: targetRepo,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}

// Tool handlers
export const orcheHandlers = {
  async spawn_worker(params: {
    task_id?: string;
    description: string;
    context?: string;
    branch_name?: string;
  }): Promise<string> {
    const taskId = params.task_id || uuidv4();
    const workerId = `worker-${uuidv4().slice(0, 8)}`;
    const projectRoot = getProjectRoot();

    // Create git worktree for this worker
    const { worktreePath, branchName } = await createWorktree(taskId, workerId, params.branch_name);

    // Create task in DB with worktree info
    await db.createTask(
      taskId,
      params.description,
      params.context,
      worktreePath,
      branchName
    );

    // Create worker-specific MCP config with environment variables
    const workerConfigPath = `${worktreePath}/.worker-config.json`;
    const dbPath = process.env.DB_PATH || `${projectRoot}/aiorchestration.db`;
    const workerConfig = {
      mcpServers: {
        aiorchestration: {
          command: "bun",
          args: [
            "run",
            `${projectRoot}/src/mcp-server.ts`,
            "--role",
            "worker",
          ],
          env: {
            PROJECT_ROOT: projectRoot,
            DB_PATH: dbPath,
            WORKER_ID: workerId,
            TASK_ID: taskId,
            WORKTREE_PATH: worktreePath,
            BRANCH_NAME: branchName,
          },
        },
      },
    };
    await Bun.write(workerConfigPath, JSON.stringify(workerConfig, null, 2));

    // Create new tmux window - worker runs in worktree directory with auto-approve
    const workerPromptPath = `${projectRoot}/prompts/worker-prompt.md`;
    const command = `cd ${worktreePath} && claude --model sonnet --dangerously-skip-permissions --mcp-config ${workerConfigPath} --system-prompt "$(cat ${workerPromptPath})" "タスクを開始してください。まず check_messages を呼んでタスク内容を確認してください。"`;

    const windowId = await tmux.newWindow(command);

    // Apply worker colors to the new window
    await setWindowStyle(windowId, "worker");
    await setWindowName(windowId, `Worker:${workerId.slice(7, 15)}`);

    // Register worker
    await db.registerWorker(workerId, windowId);
    await db.updateWorkerStatus(workerId, "running", taskId);
    await db.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS, workerId);

    // Send initial task assignment message
    await db.sendMessage(workerId, "orche", MessageType.TASK_ASSIGN, {
      task_id: taskId,
      description: params.description,
      context: params.context,
      worktree_path: worktreePath,
      branch_name: branchName,
    });

    return JSON.stringify({
      success: true,
      worker_id: workerId,
      task_id: taskId,
      window_id: windowId,
      worktree_path: worktreePath,
      branch_name: branchName,
      message: `Worker ${workerId} spawned with task ${taskId} in worktree ${worktreePath}`,
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

    // Kill tmux window if exists
    if (worker.pane_id) {
      try {
        await tmux.killWindow(worker.pane_id);
      } catch {
        // Window might already be closed
      }
    }

    // Update task status and cleanup worktree if worker had a task
    if (worker.task_id) {
      const task = await db.getTask(worker.task_id);
      await db.updateTaskStatus(worker.task_id, TaskStatus.FAILED);

      // Remove worktree
      if (task?.worktree_path) {
        try {
          await removeWorktree(task.worktree_path);
        } catch {
          // Worktree might already be removed
        }
      }
    }

    // Remove worker from DB
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
          window_id: w.pane_id,
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

  async check_messages(): Promise<string> {
    // First, check socket queue for real-time messages
    const socketMessages = socketMessageQueue.splice(0);

    // Also check database for any missed messages (fallback)
    // Use "orche" as reader_id - messages are marked as read automatically
    const { messages: dbMessages } = await db.checkMessages("orche", "orche");

    // Merge and dedupe messages
    const messageMap = new Map<string, Message>();
    for (const msg of dbMessages) {
      messageMap.set(msg.id, msg);
    }
    for (const msg of socketMessages) {
      messageMap.set(msg.id, msg);
    }
    const allMessages = Array.from(messageMap.values());

    // Process messages
    for (const msg of allMessages) {
      if (msg.type === MessageType.REVIEW_REQUEST) {
        // Forward REVIEW_REQUEST to reviewer
        const payload = msg.payload as { task_id: string; summary: string; files?: string[]; pr_url?: string };
        await db.updateTaskStatus(payload.task_id, TaskStatus.REVIEW);

        // Save PR URL to task if provided
        if (payload.pr_url) {
          await db.updateTaskPrUrl(payload.task_id, payload.pr_url);
        }

        await db.sendMessage("reviewer", "orche", MessageType.REVIEW_REQUEST, payload);
      } else if (msg.type === MessageType.TASK_ASSIGN && msg.from === "planner") {
        // Handle task from planner - spawn worker
        const payload = msg.payload as { description: string; context?: string; branch_name?: string };
        // This will be handled by the caller who should call spawn_worker
      }
    }

    return JSON.stringify({
      success: true,
      messages: allMessages.map((m) => ({
        id: m.id,
        from: m.from,
        type: m.type,
        payload: m.payload,
        timestamp: new Date(m.timestamp).toISOString(),
      })),
      count: allMessages.length,
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

    // Kill worker window
    const worker = await db.getWorker(task.worker_id);
    if (worker?.pane_id) {
      try {
        await tmux.killWindow(worker.pane_id);
      } catch {
        // Window might already be closed
      }
    }

    // Remove worktree (PR is already created, worktree is no longer needed)
    if (task.worktree_path) {
      try {
        await removeWorktree(task.worktree_path);
      } catch {
        // Worktree might already be removed
      }
    }

    // Remove worker from db
    await db.removeWorker(task.worker_id);

    return JSON.stringify({
      success: true,
      message: `Task ${params.task_id} completed. Worker ${task.worker_id} terminated.`,
      pr_url: task.pr_url,
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

  async emergency_stop(params: {
    worker_id: string;
    reason: string;
  }): Promise<string> {
    const worker = await db.getWorker(params.worker_id);

    if (!worker) {
      return JSON.stringify({
        success: false,
        error: `Worker ${params.worker_id} not found`,
      });
    }

    // Send EMERGENCY_STOP message to worker
    await db.sendMessage(params.worker_id, "orche", MessageType.EMERGENCY_STOP, {
      task_id: worker.task_id || "",
      reason: params.reason,
    });

    // Kill tmux window immediately
    if (worker.pane_id) {
      try {
        await tmux.killWindow(worker.pane_id);
      } catch {
        // Window might already be closed
      }
    }

    // Update task status
    if (worker.task_id) {
      await db.updateTaskStatus(worker.task_id, TaskStatus.FAILED);
    }

    // Remove worker
    await db.removeWorker(params.worker_id);

    // Notify planner
    await db.sendMessage("planner", "orche", MessageType.PROGRESS, {
      task_id: worker.task_id || "",
      status: "EMERGENCY_STOPPED",
      message: `Worker ${params.worker_id} was emergency stopped. Reason: ${params.reason}`,
    });

    return JSON.stringify({
      success: true,
      message: `Worker ${params.worker_id} emergency stopped. Reason: ${params.reason}`,
    });
  },
};
