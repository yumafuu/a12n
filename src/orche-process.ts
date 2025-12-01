#!/usr/bin/env bun
/**
 * Orchestrator process - runs as a bun script instead of Claude CLI
 *
 * This is an event-driven orchestrator that:
 * - Polls events table for unprocessed events
 * - Handles events mechanically based on their type
 * - Spawns workers and reviewers on demand
 * - Notifies users via terminal-notifier when tasks complete
 */

import * as db from "./lib/db.js";
import { orcheHandlers } from "./tools/orche.js";
import { EventType, TaskStatus } from "./types.js";
import type {
  Event,
  TaskCreateEventPayload,
  ReviewRequestedEventPayload,
  ReviewApprovedEventPayload,
  ReviewDeniedEventPayload,
} from "./types.js";

// Polling interval in milliseconds
const POLL_INTERVAL_MS = 1000;

// Track reviewer pane ID (spawned on-demand)
let reviewerPaneId: string = "";

// Track last checked sequence for watcher functionality
const lastCheckedSeq: Record<string, number> = {};

// Database helper for watcher functionality
function getDb() {
  const Database = require("bun:sqlite").Database;
  const DB_PATH = process.env.DB_PATH || "aiorchestration.db";
  return new Database(DB_PATH);
}

// Initialize and load persisted sequence for a recipient
function initWatcherStateTable(): void {
  const db = getDb();
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS watcher_state (
        recipient TEXT PRIMARY KEY,
        last_processed_seq INTEGER NOT NULL
      )
    `);
  } finally {
    db.close();
  }
}

function loadWatcherSeq(recipient: string): number {
  const db = getDb();
  try {
    const row = db.query(
      `SELECT last_processed_seq FROM watcher_state WHERE recipient = ?`
    ).get(recipient) as { last_processed_seq: number } | null;
    return row?.last_processed_seq ?? 0;
  } finally {
    db.close();
  }
}

function saveWatcherSeq(recipient: string, seq: number): void {
  const db = getDb();
  try {
    db.run(
      `INSERT INTO watcher_state (recipient, last_processed_seq) VALUES (?, ?)
       ON CONFLICT(recipient) DO UPDATE SET last_processed_seq = excluded.last_processed_seq`,
      [recipient, seq]
    );
  } finally {
    db.close();
  }
}

async function initializeSeq(recipient: string): Promise<void> {
  // Load the last processed seq from persistent storage
  const savedSeq = loadWatcherSeq(recipient);
  lastCheckedSeq[recipient] = savedSeq;
  log(`${recipient} starting from seq: ${savedSeq} (persisted)`);
}

// Check for new messages for a recipient
async function checkForNewMessages(
  recipient: string
): Promise<{ count: number; types: string[]; from: string[] }> {
  const db = getDb();
  try {
    const rows = db
      .query(
        `
      SELECT seq, type, from_id, payload
      FROM messages
      WHERE to_id = ? AND seq > ?
      ORDER BY seq ASC
    `
      )
      .all(recipient, lastCheckedSeq[recipient] || 0) as Array<{
      seq: number;
      type: string;
      from_id: string;
      payload: string;
    }>;

    if (rows.length > 0) {
      const newSeq = rows[rows.length - 1].seq;
      lastCheckedSeq[recipient] = newSeq;
      // Persist the processed seq to DB
      saveWatcherSeq(recipient, newSeq);
    }

    return {
      count: rows.length,
      types: rows.map((r) => r.type),
      from: rows.map((r) => r.from_id),
    };
  } finally {
    db.close();
  }
}

// Get active workers from DB
async function getActiveWorkers(): Promise<Array<{ id: string; pane_id: string }>> {
  const db = getDb();
  try {
    const rows = db
      .query(`SELECT id, pane_id FROM workers WHERE pane_id IS NOT NULL`)
      .all() as Array<{ id: string; pane_id: string }>;
    return rows;
  } finally {
    db.close();
  }
}

// Environment variables for tmux integration
const ORCHE_PANE = process.env.ORCHE_PANE || "";
const PROJECT_ROOT = process.env.PROJECT_ROOT || "";
const GENERATED_DIR = process.env.GENERATED_DIR || "";
const SESSION_UID = process.env.SESSION_UID || "";

// Format timestamp for logging
function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

// Log with timestamp
function log(message: string): void {
  console.log(`[${formatTimestamp()}] ${message}`);
}

// Build notification prompt based on message types
function buildNotificationPrompt(
  recipient: string,
  messageTypes: string[],
  fromIds: string[]
): string {
  // Worker notification
  if (recipient.startsWith("worker-")) {
    if (messageTypes.includes("REVIEW_RESULT")) {
      return "Orche からレビュー結果が来ています。check_messages を呼んで確認してください。";
    } else if (messageTypes.includes("TASK_COMPLETE")) {
      return "タスク完了通知が来ています。check_messages を呼んで確認し、終了処理をしてください。";
    } else if (messageTypes.includes("TASK_ASSIGN")) {
      return "タスクが割り当てられました。check_messages を呼んで確認し、作業を開始してください。";
    } else if (messageTypes.includes("ANSWER")) {
      return "質問への回答が来ています。check_messages を呼んで確認してください。";
    } else {
      return "新しいメッセージが来ています。check_messages を呼んで確認してください。";
    }
  }

  if (recipient === "reviewer") {
    if (messageTypes.includes("REVIEW_REQUEST")) {
      return "Orche からレビュー依頼が来ています。check_messages を呼んで確認し、PR をレビューしてください。";
    } else {
      return "新しいメッセージが来ています。check_messages を呼んで確認してください。";
    }
  }

  return "新しいメッセージが来ています。check_messages を呼んで確認してください。";
}

// Send notification to a tmux pane
async function notify(
  paneId: string,
  recipient: string,
  messageTypes: string[],
  fromIds: string[]
): Promise<void> {
  if (!paneId) {
    log(`No pane for ${recipient}, skipping notification`);
    return;
  }

  const prompt = buildNotificationPrompt(recipient, messageTypes, fromIds);

  // Send keys to pane
  try {
    // First send the prompt text
    const proc1 = Bun.spawn(["tmux", "send-keys", "-t", paneId, prompt], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc1.exited;

    // Then send Enter key separately
    const proc2 = Bun.spawn(["tmux", "send-keys", "-t", paneId, "Enter"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc2.exited;

    log(`Notified ${recipient}: ${prompt}`);
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to notify ${recipient}:`, error);
  }
}

// Spawn reviewer pane on-demand
async function spawnReviewer(): Promise<string> {
  if (!ORCHE_PANE || !PROJECT_ROOT || !GENERATED_DIR) {
    console.error("[orche] Cannot spawn reviewer: missing ORCHE_PANE, PROJECT_ROOT, or GENERATED_DIR");
    return "";
  }

  try {
    // Import tmux utilities
    const { setPaneBorderColor, setPaneTitle, setWindowName } = await import("./lib/tmux.js");

    log("Spawning reviewer pane...");

    // Split window from orche pane (creates pane on the right)
    const splitProc = Bun.spawn([
      "tmux",
      "split-window",
      "-t",
      ORCHE_PANE,
      "-h",
      "-P",
      "-F",
      "#{pane_id}",
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const newPaneId = (await new Response(splitProc.stdout).text()).trim();
    await splitProc.exited;

    if (!newPaneId) {
      console.error("[orche] Failed to get new pane ID");
      return "";
    }

    log(`Created reviewer pane: ${newPaneId}`);

    // Swap panes to move reviewer to the left of orche
    // This makes the order: reviewer | orche (in the same window)
    const swapProc = Bun.spawn([
      "tmux",
      "swap-pane",
      "-s",
      newPaneId,
      "-t",
      ORCHE_PANE,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await swapProc.exited;

    log("Swapped reviewer pane to the left of orche");

    // Get window ID for the reviewer pane
    const windowProc = Bun.spawn([
      "tmux",
      "display-message",
      "-t",
      newPaneId,
      "-p",
      "#{window_id}",
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const windowId = (await new Response(windowProc.stdout).text()).trim();
    await windowProc.exited;

    // Apply colors to reviewer pane
    await setPaneBorderColor(newPaneId, "reviewer");
    await setPaneTitle(newPaneId, "Reviewer");

    // Set window name to include Reviewer (this window is shared with orche)
    if (SESSION_UID) {
      await setWindowName(windowId, `Reviewer+Orche:${SESSION_UID}`);
    }

    // Start reviewer in the new pane
    const reviewerCmd = `claude --model opus --dangerously-skip-permissions --mcp-config ${GENERATED_DIR}/reviewer.json --system-prompt "$(cat ${PROJECT_ROOT}/prompts/reviewer-prompt.md)" "レビュー依頼が来ています。check_messages を呼んでレビューしてください。"`;

    const sendProc = Bun.spawn([
      "tmux",
      "send-keys",
      "-t",
      newPaneId,
      reviewerCmd,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await sendProc.exited;

    const enterProc = Bun.spawn([
      "tmux",
      "send-keys",
      "-t",
      newPaneId,
      "Enter",
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await enterProc.exited;

    log("Reviewer started successfully");
    return newPaneId;
  } catch (error) {
    console.error("[orche] Failed to spawn reviewer:", error);
    return "";
  }
}

// Main event processing loop
async function processEvents(): Promise<void> {
  try {
    // Get unprocessed events
    const events = await db.getUnprocessedEvents();

    if (events.length === 0) {
      return;
    }

    log(`Processing ${events.length} event(s)`);

    for (const event of events) {
      await processEvent(event);
    }
  } catch (error) {
    console.error(`[${formatTimestamp()}] Error processing events:`, error);
  }
}

// Process a single event
async function processEvent(event: Event): Promise<void> {
  log(`Processing event: ${event.type} for task ${event.task_id}`);

  try {
    switch (event.type) {
      case EventType.TASK_CREATE:
        await handleTaskCreate(event);
        break;

      case EventType.REVIEW_REQUESTED:
        await handleReviewRequested(event);
        break;

      case EventType.REVIEW_APPROVED:
        await handleReviewApproved(event);
        break;

      case EventType.REVIEW_DENIED:
        await handleReviewDenied(event);
        break;

      default:
        log(`Unknown event type: ${event.type}`);
    }

    // Mark event as processed
    await db.markEventProcessed(event.id);
  } catch (error) {
    console.error(`[${formatTimestamp()}] Error handling ${event.type}:`, error);
    // Don't mark as processed if there was an error - will retry next loop
  }
}

// Handle TASK_CREATE event
async function handleTaskCreate(event: Event): Promise<void> {
  const payload = event.payload as TaskCreateEventPayload;

  log(`Task create event: ${payload.description}`);
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

// Handle REVIEW_REQUESTED event
async function handleReviewRequested(event: Event): Promise<void> {
  const payload = event.payload as ReviewRequestedEventPayload;

  log(`Review requested for task ${event.task_id}`);
  log(`  - PR URL: ${payload.pr_url}`);
  log(`  - Summary: ${payload.summary}`);

  try {
    // Update task status to REVIEW
    await db.updateTaskStatus(event.task_id, TaskStatus.REVIEW);

    // Save PR URL
    await db.updateTaskPrUrl(event.task_id, payload.pr_url);

    // Spawn reviewer if not already running
    if (!reviewerPaneId) {
      log("Reviewer not running, spawning reviewer pane...");
      reviewerPaneId = await spawnReviewer();
    }

    log(`Reviewer will be notified about task ${event.task_id}`);
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to handle review requested:`, error);
  }
}

// Handle REVIEW_APPROVED event
async function handleReviewApproved(event: Event): Promise<void> {
  const payload = event.payload as ReviewApprovedEventPayload;

  log(`Review approved for task ${event.task_id}`);

  try {
    // Complete the task
    log(`Completing task ${event.task_id}`);
    const result = await orcheHandlers.complete_task({ task_id: event.task_id });
    const parsed = JSON.parse(result);

    if (parsed.success) {
      log(`Task completed successfully`);
      if (parsed.pr_url) {
        log(`  - PR URL: ${parsed.pr_url}`);

        // Send terminal-notifier notification
        await sendNotification(
          "Task Completed",
          `PR ${parsed.pr_url} is ready to merge`
        );
      }
    } else {
      log(`Failed to complete task: ${parsed.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to handle review approved:`, error);
  }
}

// Handle REVIEW_DENIED event
async function handleReviewDenied(event: Event): Promise<void> {
  const payload = event.payload as ReviewDeniedEventPayload;

  log(`Review denied for task ${event.task_id}`);
  log(`  - Feedback: ${payload.feedback}`);

  try {
    // Get task to find worker
    const task = await db.getTask(event.task_id);
    if (!task) {
      log(`Task ${event.task_id} not found`);
      return;
    }

    if (!task.worker_id) {
      log(`Task ${event.task_id} has no assigned worker`);
      return;
    }

    // Get worker to find pane_id
    const worker = await db.getWorker(task.worker_id);
    if (!worker || !worker.pane_id) {
      log(`Worker ${task.worker_id} not found or has no pane_id`);
      return;
    }

    // Notify worker via tmux
    log(`Notifying worker ${task.worker_id} about review feedback`);
    await notify(worker.pane_id, task.worker_id, [EventType.REVIEW_DENIED], ["orche"]);

    // Update task status back to IN_PROGRESS
    await db.updateTaskStatus(event.task_id, TaskStatus.IN_PROGRESS);
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to handle review denied:`, error);
  }
}

// Send terminal-notifier notification
async function sendNotification(title: string, message: string): Promise<void> {
  try {
    const proc = Bun.spawn([
      "terminal-notifier",
      "-title",
      title,
      "-message",
      message,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    log(`Notification sent: ${title} - ${message}`);
  } catch (error) {
    console.error(`[${formatTimestamp()}] Failed to send notification:`, error);
  }
}

// Check and notify workers and reviewer
async function checkAndNotifyAgents(): Promise<void> {
  try {
    // Check messages for reviewer
    const reviewerMessages = await checkForNewMessages("reviewer");
    if (reviewerMessages.count > 0) {
      // Notify reviewer if it's running
      if (reviewerPaneId) {
        await notify(
          reviewerPaneId,
          "reviewer",
          reviewerMessages.types,
          reviewerMessages.from
        );
      }
    }

    // Check messages for active workers
    const workers = await getActiveWorkers();
    for (const worker of workers) {
      // Initialize seq tracking for new workers from persisted state
      if (lastCheckedSeq[worker.id] === undefined) {
        const savedSeq = loadWatcherSeq(worker.id);
        lastCheckedSeq[worker.id] = savedSeq;
      }

      const workerMessages = await checkForNewMessages(worker.id);
      if (workerMessages.count > 0) {
        await notify(
          worker.pane_id,
          worker.id,
          workerMessages.types,
          workerMessages.from
        );
      }
    }
  } catch (error) {
    // DB might not be ready yet, or other transient errors
    if (!(error instanceof Error && error.message.includes("no such table"))) {
      console.error(`[${formatTimestamp()}] Error in checkAndNotifyAgents:`, error);
    }
  }
}

// Main loop
async function main(): Promise<void> {
  log("Orchestrator starting...");
  log(`Database: ${process.env.DB_PATH || 'aiorchestration.db'}`);
  log(`Target repo: ${process.env.TARGET_REPO_ROOT || process.cwd()}`);
  log(`Poll interval: ${POLL_INTERVAL_MS}ms`);
  log("");

  // Initialize watcher_state table for persistent seq tracking
  initWatcherStateTable();

  // Initialize seq tracking for reviewer (will be used when spawned)
  await initializeSeq("reviewer");

  log("Waiting for events...");

  // Poll for events
  while (true) {
    await processEvents();
    await checkAndNotifyAgents();
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
