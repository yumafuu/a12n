import { Database } from "bun:sqlite";
import { $ } from "bun";

// Configuration
const POLL_INTERVAL_MS = 2000;
const DB_PATH = process.env.DB_PATH || "aiorchestration.db";
const ORCHE_PANE = process.env.ORCHE_PANE || "";

let lastCheckedSeq = 0;

function getDb(): Database {
  return new Database(DB_PATH, { readonly: true });
}

async function getOrchePane(): Promise<string> {
  if (ORCHE_PANE) {
    return ORCHE_PANE;
  }

  // Find the first pane (assuming orche is in the first pane)
  try {
    const result = await $`tmux list-panes -F "#{pane_id}" | head -1`.text();
    return result.trim();
  } catch {
    console.error("Failed to get orche pane");
    return "";
  }
}

async function checkForNewMessages(): Promise<{ count: number; types: string[] }> {
  const db = getDb();
  try {
    const rows = db.query(`
      SELECT seq, type, from_id, payload
      FROM messages
      WHERE to_id = 'orche' AND seq > ?
      ORDER BY seq ASC
    `).all(lastCheckedSeq) as Array<{
      seq: number;
      type: string;
      from_id: string;
      payload: string;
    }>;

    if (rows.length > 0) {
      lastCheckedSeq = rows[rows.length - 1].seq;
    }

    return {
      count: rows.length,
      types: rows.map((r) => r.type),
    };
  } finally {
    db.close();
  }
}

async function notifyOrche(paneId: string, messageTypes: string[]): Promise<void> {
  // Build notification message
  let prompt: string;

  if (messageTypes.includes("QUESTION")) {
    prompt = "Worker から質問が来ています。check_messages を呼んで確認し、回答してください。";
  } else if (messageTypes.includes("REVIEW_REQUEST")) {
    prompt = "Worker からレビュー依頼が来ています。check_messages を呼んで確認し、レビューしてください。";
  } else if (messageTypes.includes("PROGRESS")) {
    prompt = "Worker から進捗報告が来ています。check_messages を呼んで確認してください。";
  } else {
    prompt = "Worker からメッセージが来ています。check_messages を呼んで確認してください。";
  }

  // Send keys to orche pane
  try {
    const proc = Bun.spawn(["tmux", "send-keys", "-t", paneId, prompt, "Enter"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    console.log(`[watcher] Notified orche: ${prompt}`);
  } catch (error) {
    console.error(`[watcher] Failed to notify orche:`, error);
  }
}

async function main(): Promise<void> {
  console.log("[watcher] Starting watcher...");
  console.log(`[watcher] DB: ${DB_PATH}`);
  console.log(`[watcher] Poll interval: ${POLL_INTERVAL_MS}ms`);

  const orchePane = await getOrchePane();
  if (!orchePane) {
    console.error("[watcher] Could not determine orche pane. Exiting.");
    process.exit(1);
  }
  console.log(`[watcher] Orche pane: ${orchePane}`);

  // Initialize lastCheckedSeq from current max
  const db = getDb();
  try {
    const result = db.query("SELECT MAX(seq) as max_seq FROM messages WHERE to_id = 'orche'").get() as { max_seq: number | null };
    lastCheckedSeq = result?.max_seq || 0;
    console.log(`[watcher] Starting from seq: ${lastCheckedSeq}`);
  } catch {
    // Table might not exist yet
    console.log("[watcher] No messages table yet, starting from 0");
  } finally {
    db.close();
  }

  // Main loop
  while (true) {
    try {
      const { count, types } = await checkForNewMessages();

      if (count > 0) {
        console.log(`[watcher] Found ${count} new message(s): ${types.join(", ")}`);
        await notifyOrche(orchePane, types);
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
