#!/usr/bin/env bun
/**
 * Orchestrator process - runs as a bun script instead of Claude CLI
 *
 * This is a deterministic message router that:
 * - Polls message_queue for messages to "orche"
 * - Routes messages between agents (planner, workers, reviewer)
 * - Spawns workers when tasks are assigned by planner
 * - Manages task lifecycle
 */

import * as db from "./lib/db.js";
import { orcheHandlers } from "./tools/orche.js";
import { MessageType, TaskStatus } from "./types.js";
import type { Message, TaskAssignPayload, ReviewRequestPayload, ReviewResultPayload } from "./types.js";

// Polling interval in milliseconds
const POLL_INTERVAL_MS = 1000;

// Format timestamp for logging
function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

// Log with timestamp
function log(message: string): void {
  console.log(`[${formatTimestamp()}] ${message}`);
}

// Main message processing loop
async function processMessages(): Promise<void> {
  try {
    // Check for messages addressed to "orche"
    const { messages } = await db.checkMessages("orche", "orche");

    if (messages.length === 0) {
      return;
    }

    log(`Received ${messages.length} message(s)`);

    for (const message of messages) {
      await processMessage(message);
    }
  } catch (error) {
    console.error(`[${formatTimestamp()}] Error processing messages:`, error);
  }
}

// Process a single message
async function processMessage(message: Message): Promise<void> {
  log(`Processing ${message.type} from ${message.from}`);

  try {
    switch (message.type) {
      case MessageType.TASK_ASSIGN:
        await handleTaskAssign(message);
        break;

      case MessageType.REVIEW_REQUEST:
        await handleReviewRequest(message);
        break;

      case MessageType.REVIEW_RESULT:
        await handleReviewResult(message);
        break;

      case MessageType.PROGRESS:
        // Log progress updates from workers
        const progressPayload = message.payload as { task_id: string; status: string; message: string };
        log(`Progress from ${message.from}: ${progressPayload.message}`);
        break;

      case MessageType.QUESTION:
        // Forward questions to planner
        log(`Question from ${message.from}, forwarding to planner`);
        await db.sendMessage("planner", "orche", MessageType.QUESTION, message.payload);
        break;

      default:
        log(`Unknown message type: ${message.type}`);
    }
  } catch (error) {
    console.error(`[${formatTimestamp()}] Error handling ${message.type}:`, error);
  }
}

// Handle TASK_ASSIGN from planner
async function handleTaskAssign(message: Message): Promise<void> {
  const payload = message.payload as TaskAssignPayload;

  log(`Task assigned from planner: ${payload.description}`);
  log(`Spawning worker for task...`);

  try {
    const result = await orcheHandlers.spawn_worker({
      task_id: payload.task_id,
      description: payload.description,
      context: payload.context,
    });

    const parsed = JSON.parse(result);
    if (parsed.success) {
      log(`Worker spawned: ${parsed.worker_id}`);
      log(`  - Task ID: ${parsed.task_id}`);
      log(`  - Worktree: ${parsed.worktree_path}`);
      log(`  - Branch: ${parsed.branch_name}`);
    } else {
      log(`Failed to spawn worker: ${parsed.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to spawn worker:`, error);
  }
}

// Handle REVIEW_REQUEST from worker
async function handleReviewRequest(message: Message): Promise<void> {
  const payload = message.payload as ReviewRequestPayload;

  log(`Review request from ${message.from}`);
  log(`  - Task ID: ${payload.task_id}`);
  log(`  - Summary: ${payload.summary}`);
  if (payload.pr_url) {
    log(`  - PR URL: ${payload.pr_url}`);
  }

  try {
    // Update task status to REVIEW
    await db.updateTaskStatus(payload.task_id, TaskStatus.REVIEW);

    // Save PR URL if provided
    if (payload.pr_url) {
      await db.updateTaskPrUrl(payload.task_id, payload.pr_url);
    }

    // Forward to reviewer
    log(`Forwarding review request to reviewer`);
    await db.sendMessage("reviewer", "orche", MessageType.REVIEW_REQUEST, payload);
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to forward review request:`, error);
  }
}

// Handle REVIEW_RESULT from reviewer
async function handleReviewResult(message: Message): Promise<void> {
  const payload = message.payload as ReviewResultPayload;

  log(`Review result from reviewer`);
  log(`  - Task ID: ${payload.task_id}`);
  log(`  - Approved: ${payload.approved}`);
  if (payload.feedback) {
    log(`  - Feedback: ${payload.feedback}`);
  }

  try {
    // Get task to find worker
    const task = await db.getTask(payload.task_id);
    if (!task) {
      log(`Task ${payload.task_id} not found`);
      return;
    }

    if (!task.worker_id) {
      log(`Task ${payload.task_id} has no assigned worker`);
      return;
    }

    if (payload.approved) {
      // Task approved - complete it
      log(`Task approved, completing task ${payload.task_id}`);
      const result = await orcheHandlers.complete_task({ task_id: payload.task_id });
      const parsed = JSON.parse(result);

      if (parsed.success) {
        log(`Task completed successfully`);
        if (parsed.pr_url) {
          log(`  - PR URL: ${parsed.pr_url}`);
        }
      } else {
        log(`Failed to complete task: ${parsed.error || 'Unknown error'}`);
      }
    } else {
      // Task needs changes - send feedback to worker
      log(`Task needs changes, sending feedback to worker ${task.worker_id}`);
      await db.sendMessage(
        task.worker_id,
        "orche",
        MessageType.REVIEW_RESULT,
        payload
      );
      await db.updateTaskStatus(payload.task_id, TaskStatus.IN_PROGRESS);
    }
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to handle review result:`, error);
  }
}

// Main loop
async function main(): Promise<void> {
  log("Orchestrator starting...");
  log(`Database: ${process.env.DB_PATH || 'aiorchestration.db'}`);
  log(`Target repo: ${process.env.TARGET_REPO_ROOT || process.cwd()}`);
  log(`Poll interval: ${POLL_INTERVAL_MS}ms`);
  log("");
  log("Waiting for messages...");

  // Poll for messages
  while (true) {
    await processMessages();
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Shutting down...");
  process.exit(0);
});

// Start the orchestrator
main().catch((error) => {
  console.error(`[${formatTimestamp()}] Fatal error:`, error);
  process.exit(1);
});
