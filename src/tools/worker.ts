import { z } from "zod";
import * as db from "../lib/db.js";
import { EventType, TaskStatus } from "../types.js";
import type { ReviewRequestedEventPayload, ReviewDeniedEventPayload } from "../types.js";

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
    name: "check_events",
    description:
      "Check for events related to this worker's task. Call this regularly to receive feedback from reviewer. Also updates heartbeat.",
    inputSchema: z.object({}),
  },
  {
    name: "update_progress",
    description: "Update task progress for dashboard visibility (legacy - optional)",
    inputSchema: z.object({
      status: z.string().describe("Current status description"),
      message: z.string().describe("Progress message"),
    }),
  },
  {
    name: "create_pr",
    description:
      "Create a GitHub Pull Request for the completed work. Call this after committing all changes and before registering review-requested event.",
    inputSchema: z.object({
      title: z.string().describe("PR title"),
      body: z.string().describe("PR body/description"),
      summary: z.string().describe("Summary of changes for the reviewer"),
    }),
  },
] as const;

// Tool handlers
export const workerHandlers = {
  async check_events(): Promise<string> {
    const workerId = getWorkerId();
    const taskId = getTaskId();

    // Update heartbeat
    await db.updateWorkerHeartbeat(workerId);

    // Get events for this task
    const events = await db.getEventsByTaskId(taskId);

    // Filter for review-denied events that haven't been processed
    const reviewDeniedEvents = events.filter(
      (e) => e.type === EventType.REVIEW_DENIED && !e.processed
    );

    // Check if task is completed
    const task = await db.getTask(taskId);
    const shouldTerminate = task?.status === TaskStatus.COMPLETED;

    if (reviewDeniedEvents.length > 0) {
      const latestEvent = reviewDeniedEvents[reviewDeniedEvents.length - 1];
      const payload = latestEvent.payload as ReviewDeniedEventPayload;

      return JSON.stringify({
        success: true,
        events: [
          {
            id: latestEvent.id,
            type: latestEvent.type,
            payload: latestEvent.payload,
            timestamp: new Date(latestEvent.timestamp).toISOString(),
          },
        ],
        count: 1,
        should_terminate: shouldTerminate,
        feedback: payload.feedback,
      });
    }

    return JSON.stringify({
      success: true,
      events: [],
      count: 0,
      should_terminate: shouldTerminate,
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

  async create_pr(params: {
    title: string;
    body: string;
    summary: string;
  }): Promise<string> {
    const workerId = getWorkerId();
    const taskId = getTaskId();
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
        "--draft",
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

    // Register review-requested event
    const payload: ReviewRequestedEventPayload = {
      task_id: taskId,
      pr_url: prUrl,
      summary: params.summary,
    };

    const eventId = await db.registerEvent(
      EventType.REVIEW_REQUESTED,
      taskId,
      payload
    );

    return JSON.stringify({
      success: true,
      pr_url: prUrl,
      event_id: eventId,
      message: `PR created and review requested: ${prUrl}`,
    });
  },
};
