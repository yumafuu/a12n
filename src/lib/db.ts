import { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import type {
  Message,
  MessageType,
  MessagePayload,
  Task,
  TaskStatus,
  Worker,
  WorkerStatus,
} from "../types.js";
import { notifyViaSocket } from "./socket.js";

// Heartbeat timeout in milliseconds
const HEARTBEAT_TIMEOUT_MS = 30000;

// Database singleton
let db: Database | null = null;

function getDbPath(): string {
  return process.env.DB_PATH || "aiorchestration.db";
}

export function getDb(): Database {
  if (!db) {
    db = new Database(getDbPath());
    initSchema();
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(): void {
  const database = getDb();

  database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      seq INTEGER UNIQUE,
      timestamp INTEGER NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      worker_id TEXT,
      description TEXT NOT NULL,
      context TEXT,
      worktree_path TEXT,
      branch_name TEXT,
      pr_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      task_id TEXT,
      pane_id TEXT,
      last_heartbeat INTEGER NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS watcher_state (
      recipient TEXT PRIMARY KEY,
      last_processed_seq INTEGER NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      reader_id TEXT NOT NULL,
      read_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, reader_id)
    )
  `);

  // Create indexes
  database.run(`CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_messages_seq ON messages(seq)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON workers(last_heartbeat)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_message_reads_reader ON message_reads(reader_id)`);
}

// Auto-increment for message sequence
function getNextSeq(): number {
  const database = getDb();
  const result = database.query("SELECT MAX(seq) as max_seq FROM messages").get() as { max_seq: number | null };
  return (result?.max_seq || 0) + 1;
}

// Message operations
export async function sendMessage(
  to: string,
  from: string,
  type: MessageType,
  payload: MessagePayload
): Promise<string> {
  const database = getDb();
  const message: Message = {
    id: uuidv4(),
    timestamp: Date.now(),
    from,
    to,
    type,
    payload,
  };

  const seq = getNextSeq();

  database.run(
    `INSERT INTO messages (id, seq, timestamp, from_id, to_id, type, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [message.id, seq, message.timestamp, message.from, message.to, message.type, JSON.stringify(message.payload)]
  );

  // Notify via socket for real-time delivery
  try {
    notifyViaSocket(message);
  } catch (err) {
    // Socket notification is best-effort, don't fail if it errors
    console.error("Socket notification failed:", err);
  }

  return message.id;
}

export async function checkMessages(
  recipient: string,
  readerId: string
): Promise<{ messages: Message[] }> {
  const database = getDb();

  // Get unread messages using LEFT JOIN with message_reads
  const rows = database.query(
    `SELECT m.id, m.seq, m.timestamp, m.from_id, m.to_id, m.type, m.payload
     FROM messages m
     LEFT JOIN message_reads r ON m.id = r.message_id AND r.reader_id = ?
     WHERE m.to_id = ? AND r.message_id IS NULL
     ORDER BY m.seq ASC
     LIMIT 100`
  ).all(readerId, recipient) as Array<{
    id: string;
    seq: number;
    timestamp: number;
    from_id: string;
    to_id: string;
    type: string;
    payload: string;
  }>;

  const messages: Message[] = rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    from: row.from_id,
    to: row.to_id,
    type: row.type as MessageType,
    payload: JSON.parse(row.payload),
  }));

  // Mark messages as read
  if (messages.length > 0) {
    const now = Date.now();
    const insertStmt = database.prepare(
      `INSERT OR IGNORE INTO message_reads (message_id, reader_id, read_at) VALUES (?, ?, ?)`
    );
    for (const msg of messages) {
      insertStmt.run(msg.id, readerId, now);
    }
  }

  return { messages };
}

// Task operations
export async function createTask(
  taskId: string,
  description: string,
  context?: string,
  worktreePath?: string,
  branchName?: string
): Promise<Task> {
  const database = getDb();
  const now = Date.now();
  const task: Task = {
    id: taskId,
    status: "pending",
    description,
    context,
    worktree_path: worktreePath,
    branch_name: branchName,
    created_at: now,
    updated_at: now,
  };

  database.run(
    `INSERT INTO tasks (id, status, description, context, worktree_path, branch_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.status, task.description, task.context || null, task.worktree_path || null, task.branch_name || null, task.created_at, task.updated_at]
  );

  return task;
}

export async function getTask(taskId: string): Promise<Task | null> {
  const database = getDb();
  const row = database.query(
    `SELECT id, status, worker_id, description, context, worktree_path, branch_name, pr_url, created_at, updated_at FROM tasks WHERE id = ?`
  ).get(taskId) as {
    id: string;
    status: string;
    worker_id: string | null;
    description: string;
    context: string | null;
    worktree_path: string | null;
    branch_name: string | null;
    pr_url: string | null;
    created_at: number;
    updated_at: number;
  } | null;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: row.status as TaskStatus,
    worker_id: row.worker_id || undefined,
    description: row.description,
    context: row.context || undefined,
    worktree_path: row.worktree_path || undefined,
    branch_name: row.branch_name || undefined,
    pr_url: row.pr_url || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  workerId?: string
): Promise<void> {
  const database = getDb();
  const now = Date.now();

  if (workerId !== undefined) {
    database.run(
      `UPDATE tasks SET status = ?, worker_id = ?, updated_at = ? WHERE id = ?`,
      [status, workerId, now, taskId]
    );
  } else {
    database.run(
      `UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`,
      [status, now, taskId]
    );
  }
}

export async function listAllTasks(): Promise<Task[]> {
  const database = getDb();
  const rows = database.query(
    `SELECT id, status, worker_id, description, context, worktree_path, branch_name, pr_url, created_at, updated_at
     FROM tasks
     ORDER BY created_at DESC`
  ).all() as Array<{
    id: string;
    status: string;
    worker_id: string | null;
    description: string;
    context: string | null;
    worktree_path: string | null;
    branch_name: string | null;
    pr_url: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    status: row.status as TaskStatus,
    worker_id: row.worker_id || undefined,
    description: row.description,
    context: row.context || undefined,
    worktree_path: row.worktree_path || undefined,
    branch_name: row.branch_name || undefined,
    pr_url: row.pr_url || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function updateTaskPrUrl(
  taskId: string,
  prUrl: string
): Promise<void> {
  const database = getDb();
  const now = Date.now();
  database.run(
    `UPDATE tasks SET pr_url = ?, updated_at = ? WHERE id = ?`,
    [prUrl, now, taskId]
  );
}

// Worker operations
export async function registerWorker(
  workerId: string,
  paneId?: string
): Promise<Worker> {
  const database = getDb();
  const now = Date.now();
  const worker: Worker = {
    id: workerId,
    status: "idle",
    last_heartbeat: now,
    pane_id: paneId,
  };

  database.run(
    `INSERT INTO workers (id, status, pane_id, last_heartbeat) VALUES (?, ?, ?, ?)`,
    [worker.id, worker.status, worker.pane_id || null, worker.last_heartbeat]
  );

  return worker;
}

export async function updateWorkerHeartbeat(workerId: string): Promise<void> {
  const database = getDb();
  const now = Date.now();
  database.run(
    `UPDATE workers SET last_heartbeat = ? WHERE id = ?`,
    [now, workerId]
  );
}

export async function updateWorkerStatus(
  workerId: string,
  status: WorkerStatus,
  taskId?: string
): Promise<void> {
  const database = getDb();
  const now = Date.now();

  if (taskId !== undefined) {
    database.run(
      `UPDATE workers SET status = ?, task_id = ?, last_heartbeat = ? WHERE id = ?`,
      [status, taskId, now, workerId]
    );
  } else {
    database.run(
      `UPDATE workers SET status = ?, last_heartbeat = ? WHERE id = ?`,
      [status, now, workerId]
    );
  }
}

export async function getWorker(workerId: string): Promise<Worker | null> {
  const database = getDb();
  const row = database.query(
    `SELECT id, status, task_id, pane_id, last_heartbeat FROM workers WHERE id = ?`
  ).get(workerId) as {
    id: string;
    status: string;
    task_id: string | null;
    pane_id: string | null;
    last_heartbeat: number;
  } | null;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: row.status as WorkerStatus,
    task_id: row.task_id || undefined,
    pane_id: row.pane_id || undefined,
    last_heartbeat: row.last_heartbeat,
  };
}

export async function listActiveWorkers(): Promise<Worker[]> {
  const database = getDb();
  const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;

  const rows = database.query(
    `SELECT id, status, task_id, pane_id, last_heartbeat
     FROM workers
     WHERE last_heartbeat > ?`
  ).all(cutoff) as Array<{
    id: string;
    status: string;
    task_id: string | null;
    pane_id: string | null;
    last_heartbeat: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    status: row.status as WorkerStatus,
    task_id: row.task_id || undefined,
    pane_id: row.pane_id || undefined,
    last_heartbeat: row.last_heartbeat,
  }));
}

export async function removeWorker(workerId: string): Promise<void> {
  const database = getDb();
  database.run(`DELETE FROM workers WHERE id = ?`, [workerId]);
  // Also clean up messages to this worker
  database.run(`DELETE FROM messages WHERE to_id = ?`, [workerId]);
}

// Watcher state operations
export function getWatcherSeq(recipient: string): number {
  const database = getDb();
  const row = database.query(
    `SELECT last_processed_seq FROM watcher_state WHERE recipient = ?`
  ).get(recipient) as { last_processed_seq: number } | null;

  return row?.last_processed_seq ?? 0;
}

export function saveWatcherSeq(recipient: string, seq: number): void {
  const database = getDb();
  database.run(
    `INSERT INTO watcher_state (recipient, last_processed_seq) VALUES (?, ?)
     ON CONFLICT(recipient) DO UPDATE SET last_processed_seq = excluded.last_processed_seq`,
    [recipient, seq]
  );
}

