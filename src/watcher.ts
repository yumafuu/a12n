import { Database } from "bun:sqlite";
import { $ } from "bun";

// Configuration
const POLL_INTERVAL_MS = 2000;
const DB_PATH = process.env.DB_PATH || "aiorchestration.db";
const ORCHE_PANE = process.env.ORCHE_PANE || "";
const PROJECT_ROOT = process.env.PROJECT_ROOT || "";
const GENERATED_DIR = process.env.GENERATED_DIR || "";
const SESSION_UID = process.env.SESSION_UID || "";

// Track last checked sequence for each recipient
const lastCheckedSeq: Record<string, number> = {};

// Track worker pane IDs
const workerPanes: Record<string, string> = {};

// Track reviewer pane ID (spawned on-demand)
let reviewerPaneId: string = "";

function getDb(): Database {
  return new Database(DB_PATH);
}

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

async function getPanes(): Promise<{ orche: string; reviewer: string }> {
  const orchePane = ORCHE_PANE;

  // Reviewer pane is spawned on-demand, return current state
  return { orche: orchePane, reviewer: reviewerPaneId };
}

async function spawnReviewer(): Promise<string> {
  if (!ORCHE_PANE || !PROJECT_ROOT || !GENERATED_DIR) {
    console.error("[watcher] Cannot spawn reviewer: missing ORCHE_PANE, PROJECT_ROOT, or GENERATED_DIR");
    return "";
  }

  try {
    // Import tmux utilities
    const { setPaneBorderColor, setPaneTitle, setWindowName } = await import("./lib/tmux.js");

    console.log("[watcher] Spawning reviewer pane...");

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
      console.error("[watcher] Failed to get new pane ID");
      return "";
    }

    console.log(`[watcher] Created reviewer pane: ${newPaneId}`);

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

    console.log(`[watcher] Swapped reviewer pane to the left of orche`);

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

    console.log("[watcher] Reviewer started successfully");
    return newPaneId;
  } catch (error) {
    console.error("[watcher] Failed to spawn reviewer:", error);
    return "";
  }
}

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
      .all(recipient, lastCheckedSeq[recipient]) as Array<{
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

  if (recipient === "orche") {
    if (messageTypes.includes("TASK_ASSIGN")) {
      return "Planner からタスクが来ています。check_messages を呼んで確認し、spawn_worker でワーカーを起動してください。";
    } else if (messageTypes.includes("REVIEW_RESULT")) {
      return "Reviewer からレビュー結果が来ています。check_messages を呼んで確認し、Worker に転送してください。";
    } else if (messageTypes.includes("QUESTION")) {
      return "Worker から質問が来ています。check_messages を呼んで確認し、回答してください。";
    } else if (messageTypes.includes("REVIEW_REQUEST")) {
      return "Worker からレビュー依頼が来ています。check_messages を呼んで確認してください（自動で Reviewer に転送されます）。";
    } else if (messageTypes.includes("PROGRESS")) {
      return "Worker から進捗報告が来ています。check_messages を呼んで確認してください。";
    } else {
      return "新しいメッセージが来ています。check_messages を呼んで確認してください。";
    }
  } else if (recipient === "reviewer") {
    if (messageTypes.includes("REVIEW_REQUEST")) {
      return "Orche からレビュー依頼が来ています。check_messages を呼んで確認し、PR をレビューしてください。";
    } else {
      return "新しいメッセージが来ています。check_messages を呼んで確認してください。";
    }
  }

  return "新しいメッセージが来ています。check_messages を呼んで確認してください。";
}

async function notify(
  paneId: string,
  recipient: string,
  messageTypes: string[],
  fromIds: string[]
): Promise<void> {
  if (!paneId) {
    console.log(`[watcher] No pane for ${recipient}, skipping notification`);
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

    console.log(`[watcher] Notified ${recipient}: ${prompt}`);
  } catch (error) {
    console.error(`[watcher] Failed to notify ${recipient}:`, error);
  }
}

async function initializeSeq(recipient: string): Promise<void> {
  // Load the last processed seq from persistent storage
  const savedSeq = loadWatcherSeq(recipient);
  lastCheckedSeq[recipient] = savedSeq;
  console.log(
    `[watcher] ${recipient} starting from seq: ${savedSeq} (persisted)`
  );
}

async function main(): Promise<void> {
  console.log("[watcher] Starting watcher...");
  console.log(`[watcher] DB: ${DB_PATH}`);
  console.log(`[watcher] Poll interval: ${POLL_INTERVAL_MS}ms`);

  // Initialize watcher_state table for persistent seq tracking
  initWatcherStateTable();

  const panes = await getPanes();
  console.log(`[watcher] Orche pane: ${panes.orche || "(not found)"}`);
  console.log(`[watcher] Reviewer pane: (on-demand, will spawn when REVIEW_REQUEST is received)`);

  if (!panes.orche) {
    console.error("[watcher] Could not determine orche pane. Exiting.");
    process.exit(1);
  }

  // Initialize lastCheckedSeq from persisted state
  await initializeSeq("orche");
  // Reviewer seq will be initialized when spawned

  // Main loop
  while (true) {
    try {
      // Note: orche runs as a bun process with its own polling loop, so we don't notify it
      // Just track messages for logging purposes
      const orcheMessages = await checkForNewMessages("orche");
      if (orcheMessages.count > 0) {
        console.log(
          `[watcher] Found ${orcheMessages.count} new message(s) for orche: ${orcheMessages.types.join(", ")} (orche handles its own polling)`
        );
      }

      // Check messages for reviewer
      const reviewerMessages = await checkForNewMessages("reviewer");
      if (reviewerMessages.count > 0) {
        console.log(
          `[watcher] Found ${reviewerMessages.count} new message(s) for reviewer: ${reviewerMessages.types.join(", ")}`
        );

        // If REVIEW_REQUEST is detected and reviewer is not running, spawn it
        if (reviewerMessages.types.includes("REVIEW_REQUEST") && !reviewerPaneId) {
          console.log("[watcher] REVIEW_REQUEST detected, spawning reviewer...");
          reviewerPaneId = await spawnReviewer();
          if (reviewerPaneId) {
            // Initialize seq tracking for reviewer
            await initializeSeq("reviewer");
          }
        }

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
          console.log(`[watcher] New worker detected: ${worker.id} (pane: ${worker.pane_id}, seq: ${savedSeq})`);
        }
        workerPanes[worker.id] = worker.pane_id;

        const workerMessages = await checkForNewMessages(worker.id);
        if (workerMessages.count > 0) {
          console.log(
            `[watcher] Found ${workerMessages.count} new message(s) for ${worker.id}: ${workerMessages.types.join(", ")}`
          );
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
        console.error("[watcher] Error:", error);
      }
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

main().catch(console.error);
