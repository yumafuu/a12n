import { Database } from "bun:sqlite";
import { $ } from "bun";

// Configuration
const POLL_INTERVAL_MS = 2000;
const DB_PATH = process.env.DB_PATH || "aiorchestration.db";
const ORCHE_PANE = process.env.ORCHE_PANE || "";
const PLANNER_PANE = process.env.PLANNER_PANE || "";

// Track last checked sequence for each recipient
const lastCheckedSeq: Record<string, number> = {
  orche: 0,
  planner: 0,
};

// Track worker pane IDs
const workerPanes: Record<string, string> = {};

function getDb(): Database {
  return new Database(DB_PATH, { readonly: true });
}

async function getPanes(): Promise<{ orche: string; planner: string }> {
  let orchePane = ORCHE_PANE;
  let plannerPane = PLANNER_PANE;

  if (!orchePane || !plannerPane) {
    // Get all panes - assume planner is pane 0 (left), orche is pane 1 (right)
    try {
      const result = await $`tmux list-panes -F "#{pane_id}"`.text();
      const panes = result.trim().split("\n");
      if (panes.length >= 2) {
        plannerPane = plannerPane || panes[0];
        orchePane = orchePane || panes[1];
      } else if (panes.length === 1) {
        // Only one pane, assume it's orche
        orchePane = orchePane || panes[0];
      }
    } catch {
      console.error("[watcher] Failed to get panes");
    }
  }

  return { orche: orchePane, planner: plannerPane };
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
      lastCheckedSeq[recipient] = rows[rows.length - 1].seq;
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
      return "Planner からレビュー結果が来ています。check_messages を呼んで確認し、Worker に転送してください。";
    } else if (messageTypes.includes("QUESTION")) {
      return "Worker から質問が来ています。check_messages を呼んで確認し、回答してください。";
    } else if (messageTypes.includes("REVIEW_REQUEST")) {
      return "Worker からレビュー依頼が来ています。check_messages を呼んで確認してください（自動で Planner に転送されます）。";
    } else if (messageTypes.includes("PROGRESS")) {
      return "Worker から進捗報告が来ています。check_messages を呼んで確認してください。";
    } else {
      return "新しいメッセージが来ています。check_messages を呼んで確認してください。";
    }
  } else if (recipient === "planner") {
    if (messageTypes.includes("REVIEW_REQUEST")) {
      return "Orche からレビュー依頼が転送されました。check_messages を呼んで確認し、レビューしてください。";
    } else if (messageTypes.includes("QUESTION")) {
      return "質問が来ています。check_messages を呼んで確認し、回答してください。";
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
  // Start from 0 so we catch any unprocessed messages on startup
  lastCheckedSeq[recipient] = 0;
  console.log(
    `[watcher] ${recipient} starting from seq: 0 (will check all messages)`
  );
}

async function main(): Promise<void> {
  console.log("[watcher] Starting watcher...");
  console.log(`[watcher] DB: ${DB_PATH}`);
  console.log(`[watcher] Poll interval: ${POLL_INTERVAL_MS}ms`);

  const panes = await getPanes();
  console.log(`[watcher] Planner pane: ${panes.planner || "(not found)"}`);
  console.log(`[watcher] Orche pane: ${panes.orche || "(not found)"}`);

  if (!panes.orche && !panes.planner) {
    console.error("[watcher] Could not determine any panes. Exiting.");
    process.exit(1);
  }

  // Initialize lastCheckedSeq from current max
  await initializeSeq("orche");
  await initializeSeq("planner");

  // Main loop
  while (true) {
    try {
      // Check messages for orche
      const orcheMessages = await checkForNewMessages("orche");
      if (orcheMessages.count > 0) {
        console.log(
          `[watcher] Found ${orcheMessages.count} new message(s) for orche: ${orcheMessages.types.join(", ")}`
        );
        await notify(
          panes.orche,
          "orche",
          orcheMessages.types,
          orcheMessages.from
        );
      }

      // Check messages for planner
      const plannerMessages = await checkForNewMessages("planner");
      if (plannerMessages.count > 0) {
        console.log(
          `[watcher] Found ${plannerMessages.count} new message(s) for planner: ${plannerMessages.types.join(", ")}`
        );
        await notify(
          panes.planner,
          "planner",
          plannerMessages.types,
          plannerMessages.from
        );
      }

      // Check messages for active workers
      const workers = await getActiveWorkers();
      for (const worker of workers) {
        // Initialize seq tracking for new workers
        if (lastCheckedSeq[worker.id] === undefined) {
          lastCheckedSeq[worker.id] = 0;
          console.log(`[watcher] New worker detected: ${worker.id} (pane: ${worker.pane_id})`);
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
