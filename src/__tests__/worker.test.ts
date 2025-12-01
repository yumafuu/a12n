import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlink } from "fs/promises";
import { getDb, closeDb, registerEvent, registerWorker, createTask } from "../lib/db.js";
import { workerHandlers } from "../tools/worker.js";
import { EventType, TaskStatus } from "../types.js";

const TEST_DB_PATH = "test-worker.db";

describe("workerHandlers", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.WORKER_ID = "test-worker";
    process.env.TASK_ID = "test-task";
    getDb();
    // Register the worker
    registerWorker("test-worker");
    createTask("test-task", "Test task");
  });

  afterEach(async () => {
    closeDb();
    delete process.env.WORKER_ID;
    delete process.env.TASK_ID;
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore
    }
  });

  describe("check_events", () => {
    test("should return empty events initially", async () => {
      const result = JSON.parse(await workerHandlers.check_events());

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(0);
      expect(result.count).toBe(0);
      expect(result.should_terminate).toBe(false);
    });

    test("should return review-denied event with feedback", async () => {
      await registerEvent(EventType.REVIEW_DENIED, "test-task", {
        task_id: "test-task",
        feedback: "Please fix the bug",
      });

      const result = JSON.parse(await workerHandlers.check_events());

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe(EventType.REVIEW_DENIED);
      expect(result.feedback).toBe("Please fix the bug");
    });

    test("should set should_terminate when task is completed", async () => {
      // Update task status to completed
      const db = getDb();
      db.run("UPDATE tasks SET status = ? WHERE id = ?", [TaskStatus.COMPLETED, "test-task"]);

      const result = JSON.parse(await workerHandlers.check_events());

      expect(result.success).toBe(true);
      expect(result.should_terminate).toBe(true);
    });
  });

  describe("update_progress", () => {
    test("should send progress update (legacy)", async () => {
      const result = JSON.parse(
        await workerHandlers.update_progress({
          status: "working",
          message: "Making progress",
        })
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Progress updated");
    });
  });

  describe("environment variable handling", () => {
    test("should throw error if WORKER_ID is not set", async () => {
      delete process.env.WORKER_ID;

      try {
        await workerHandlers.check_events();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("WORKER_ID");
      }
    });
  });

  // TODO: Add tests for create_pr when gh CLI can be mocked
  // describe("create_pr", () => { ... });
});
