import { z } from "zod";
import * as db from "../lib/db.js";
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

// Get worktree path from environment
function getWorktreePath(): string {
  return process.env.WORKTREE_PATH || process.cwd();
}

// Get branch name from environment
function getBranchName(): string {
  return process.env.BRANCH_NAME || "";
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
  {
    name: "create_pr",
    description:
      "Create a GitHub Pull Request for the completed work. Call this after committing all changes and before sending REVIEW_REQUEST.",
    inputSchema: z.object({
      title: z.string().describe("PR title"),
      body: z.string().describe("PR body/description"),
    }),
  },
  {
    name: "execute_command",
    description:
      "Execute a shell command in a specified directory. Use this to run build commands, tests, or other development tools.",
    inputSchema: z.object({
      command: z
        .string()
        .describe('The command to execute (e.g., "bun run start", "npm run dev")'),
      working_directory: z
        .string()
        .describe("The directory to execute the command in"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default: 30000)"),
      background: z
        .boolean()
        .optional()
        .describe("Run in background (default: false)"),
    }),
  },
] as const;

// Store last message ID for pagination
let lastMessageId = "0";

// Dangerous command patterns to block
const DANGEROUS_PATTERNS = [
  // File system destruction
  /rm\s+(-rf?|-fr?)\s+[\/~]/i,  // rm -rf / or rm -rf ~
  /rm\s+(-rf?|-fr?)\s+\*/i,     // rm -rf *
  /rm\s+(-rf?|-fr?)\s+\.\./i,   // rm -rf ..
  />\s*\/dev\/sd[a-z]/i,        // Writing to disk devices
  /mkfs\./i,                    // Format filesystems
  /dd\s+if=.*of=\/dev/i,        // dd to devices

  // Dangerous git operations
  /git\s+push\s+.*--force/i,    // git push --force
  /git\s+push\s+-f/i,           // git push -f
  /git\s+reset\s+--hard/i,      // git reset --hard
  /git\s+clean\s+-fd/i,         // git clean -fd

  // Sensitive file access
  /cat\s+.*\.env/i,             // Reading .env files
  /echo\s+.*>.*\.env/i,         // Writing to .env files

  // Network/security risks
  /curl\s+.*\|\s*(ba)?sh/i,     // Piping curl to shell
  /wget\s+.*\|\s*(ba)?sh/i,     // Piping wget to shell

  // Production operations
  /production|prod(?:uction)?/i, // Commands containing "production"
];

function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        dangerous: true,
        reason: `Command matches dangerous pattern: ${pattern.source}`,
      };
    }
  }
  return { dangerous: false };
}

// Tool handlers
export const workerHandlers = {
  async check_messages(params: { last_id?: string }): Promise<string> {
    const workerId = getWorkerId();

    // Update heartbeat
    await db.updateWorkerHeartbeat(workerId);

    // Check messages
    const { messages, lastId } = await db.checkMessages(
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
    await db.updateWorkerHeartbeat(workerId);

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

    const messageId = await db.sendMessage(
      "orche",
      workerId,
      params.type as MessageType,
      payload as never
    );

    // Update task status if sending review request
    if (params.type === "REVIEW_REQUEST") {
      await db.updateTaskStatus(taskId, TaskStatus.REVIEW);
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
    await db.updateWorkerHeartbeat(workerId);

    // Send progress message
    const messageId = await db.sendMessage(
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

  async create_pr(params: { title: string; body: string }): Promise<string> {
    const workerId = getWorkerId();
    const worktreePath = getWorktreePath();
    const branchName = getBranchName();

    // Update heartbeat
    await db.updateWorkerHeartbeat(workerId);

    if (!branchName) {
      return JSON.stringify({
        success: false,
        error: "Branch name not set. Cannot create PR.",
      });
    }

    // Push the branch to remote
    const pushProc = Bun.spawn(["git", "push", "-u", "origin", branchName], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const pushStderr = await new Response(pushProc.stderr).text();
    const pushExitCode = await pushProc.exited;

    if (pushExitCode !== 0) {
      return JSON.stringify({
        success: false,
        error: `Failed to push branch: ${pushStderr}`,
      });
    }

    // Create PR using gh CLI
    const prProc = Bun.spawn(
      [
        "gh",
        "pr",
        "create",
        "--title",
        params.title,
        "--body",
        params.body,
        "--head",
        branchName,
      ],
      {
        cwd: worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const prStdout = await new Response(prProc.stdout).text();
    const prStderr = await new Response(prProc.stderr).text();
    const prExitCode = await prProc.exited;

    if (prExitCode !== 0) {
      return JSON.stringify({
        success: false,
        error: `Failed to create PR: ${prStderr}`,
      });
    }

    const prUrl = prStdout.trim();

    return JSON.stringify({
      success: true,
      pr_url: prUrl,
      message: `PR created: ${prUrl}`,
    });
  },

  async execute_command(params: {
    command: string;
    working_directory: string;
    timeout?: number;
    background?: boolean;
  }): Promise<string> {
    const workerId = getWorkerId();
    const timeout = params.timeout ?? 30000;
    const background = params.background ?? false;

    // Update heartbeat
    await db.updateWorkerHeartbeat(workerId);

    // Check for dangerous commands
    const dangerCheck = isDangerousCommand(params.command);
    if (dangerCheck.dangerous) {
      return JSON.stringify({
        success: false,
        error: `Dangerous command blocked: ${dangerCheck.reason}`,
        blocked: true,
      });
    }

    // Verify working directory exists
    try {
      // Check if it's a directory
      const dirCheck = Bun.spawn(["test", "-d", params.working_directory], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const dirCheckExitCode = await dirCheck.exited;
      if (dirCheckExitCode !== 0) {
        return JSON.stringify({
          success: false,
          error: `Working directory does not exist or is not a directory: ${params.working_directory}`,
        });
      }
    } catch {
      return JSON.stringify({
        success: false,
        error: `Cannot access working directory: ${params.working_directory}`,
      });
    }

    // Parse command into shell execution
    const proc = Bun.spawn(["sh", "-c", params.command], {
      cwd: params.working_directory,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (background) {
      // For background processes, return immediately with PID
      return JSON.stringify({
        success: true,
        background: true,
        pid: proc.pid,
        message: `Command started in background with PID ${proc.pid}`,
      });
    }

    // Wait for completion with timeout
    let stdout = "";
    let stderr = "";
    let exit_code = -1;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeout);
      });

      const processPromise = (async () => {
        stdout = await new Response(proc.stdout).text();
        stderr = await new Response(proc.stderr).text();
        exit_code = await proc.exited;
      })();

      await Promise.race([processPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message === "timeout") {
        proc.kill();
        return JSON.stringify({
          success: false,
          error: `Command timed out after ${timeout}ms`,
          stdout: stdout.slice(0, 10000), // Limit output size
          stderr: stderr.slice(0, 10000),
          timed_out: true,
        });
      }
      throw error;
    }

    // Truncate output if too large
    const maxOutputSize = 50000;
    const truncatedStdout =
      stdout.length > maxOutputSize
        ? stdout.slice(0, maxOutputSize) + "\n... (truncated)"
        : stdout;
    const truncatedStderr =
      stderr.length > maxOutputSize
        ? stderr.slice(0, maxOutputSize) + "\n... (truncated)"
        : stderr;

    return JSON.stringify({
      success: exit_code === 0,
      stdout: truncatedStdout,
      stderr: truncatedStderr,
      exit_code,
      timed_out: false,
    });
  },
};
