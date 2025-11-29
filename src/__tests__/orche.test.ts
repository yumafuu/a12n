import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { unlink } from "fs/promises";
import { getDb, closeDb, getWorker, getTask } from "../lib/db.js";
import { orcheHandlers } from "../tools/orche.js";
import { TaskStatus } from "../types.js";

const TEST_DB_PATH = "test-orche.db";

// Mock tmux functions
const mockSplitPane = mock(() => Promise.resolve("%99"));
const mockKillPane = mock(() => Promise.resolve());

// Mock the tmux module
mock.module("../lib/tmux.js", () => ({
  splitPane: mockSplitPane,
  killPane: mockKillPane,
  checkTmux: () => Promise.resolve(),
}));

describe("orcheHandlers", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.PROJECT_ROOT = "/tmp/test-project";
    getDb();
    mockSplitPane.mockClear();
    mockKillPane.mockClear();
  });

  afterEach(async () => {
    closeDb();
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore
    }
  });

  describe("list_workers", () => {
    test("should return empty list when no workers", async () => {
      const result = JSON.parse(await orcheHandlers.list_workers());

      expect(result.success).toBe(true);
      expect(result.workers).toHaveLength(0);
      expect(result.message).toBe("No active workers");
    });
  });

  describe("check_messages", () => {
    test("should return empty messages initially", async () => {
      const result = JSON.parse(await orcheHandlers.check_messages({}));

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    test("should accept last_id parameter", async () => {
      const result = JSON.parse(
        await orcheHandlers.check_messages({ last_id: "5" })
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(0);
    });
  });

  describe("get_task_status", () => {
    test("should return error for non-existent task", async () => {
      const result = JSON.parse(
        await orcheHandlers.get_task_status({ task_id: "non-existent" })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("kill_worker", () => {
    test("should return error for non-existent worker", async () => {
      const result = JSON.parse(
        await orcheHandlers.kill_worker({ worker_id: "non-existent" })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("send_message", () => {
    test("should return error for non-existent worker", async () => {
      const result = JSON.parse(
        await orcheHandlers.send_message({
          worker_id: "non-existent",
          type: "ANSWER",
          payload: '{"answer": "test"}',
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("should return error for invalid JSON payload", async () => {
      // First register a worker manually
      const db = getDb();
      db.run(
        "INSERT INTO workers (id, status, last_heartbeat) VALUES (?, ?, ?)",
        ["worker-1", "running", Date.now()]
      );

      const result = JSON.parse(
        await orcheHandlers.send_message({
          worker_id: "worker-1",
          type: "ANSWER",
          payload: "invalid-json",
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON payload");
    });
  });

  describe("complete_task", () => {
    test("should return error for non-existent task", async () => {
      const result = JSON.parse(
        await orcheHandlers.complete_task({ task_id: "non-existent" })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("should return error for task without worker", async () => {
      // Create task without worker
      const db = getDb();
      const now = Date.now();
      db.run(
        "INSERT INTO tasks (id, status, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ["task-1", "pending", "Test task", now, now]
      );

      const result = JSON.parse(
        await orcheHandlers.complete_task({ task_id: "task-1" })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("no assigned worker");
    });

    test("should complete task with worker", async () => {
      const db = getDb();
      const now = Date.now();

      // Create worker
      db.run(
        "INSERT INTO workers (id, status, task_id, last_heartbeat) VALUES (?, ?, ?, ?)",
        ["worker-1", "running", "task-1", now]
      );

      // Create task with worker
      db.run(
        "INSERT INTO tasks (id, status, worker_id, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ["task-1", "in_progress", "worker-1", "Test task", now, now]
      );

      const result = JSON.parse(
        await orcheHandlers.complete_task({ task_id: "task-1" })
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("completed");

      // Verify task status
      const task = await getTask("task-1");
      expect(task?.status).toBe(TaskStatus.COMPLETED);
    });
  });
});
