import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlink } from "fs/promises";
import { getDb, closeDb, sendMessage, checkMessages, registerWorker, createTask } from "../lib/db.js";
import { workerHandlers } from "../tools/worker.js";
import { MessageType, TaskStatus } from "../types.js";

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

  describe("check_messages", () => {
    test("should return empty messages initially", async () => {
      const result = JSON.parse(await workerHandlers.check_messages({}));

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(0);
      expect(result.count).toBe(0);
      expect(result.should_terminate).toBe(false);
    });

    test("should return messages sent to the worker", async () => {
      await sendMessage("test-worker", "orche", MessageType.TASK_ASSIGN, {
        task_id: "test-task",
        description: "Test task",
      });

      const result = JSON.parse(await workerHandlers.check_messages({}));

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe(MessageType.TASK_ASSIGN);
    });

    test("should set should_terminate when TASK_COMPLETE received", async () => {
      await sendMessage("test-worker", "orche", MessageType.TASK_COMPLETE, {
        task_id: "test-task",
      });

      // Explicitly pass last_id: "0" to get all messages from the beginning
      const result = JSON.parse(await workerHandlers.check_messages({ last_id: "0" }));

      expect(result.success).toBe(true);
      expect(result.should_terminate).toBe(true);
      expect(result.terminate_reason).toContain("TASK_COMPLETE");
    });

    test("should paginate with last_id", async () => {
      await sendMessage("test-worker", "orche", MessageType.TASK_ASSIGN, {
        task_id: "test-task",
        description: "Task 1",
      });

      // Explicitly pass last_id: "0" to get all messages from the beginning
      const result1 = JSON.parse(await workerHandlers.check_messages({ last_id: "0" }));
      expect(result1.messages).toHaveLength(1);

      // Second call with last_id should return empty
      const result2 = JSON.parse(
        await workerHandlers.check_messages({ last_id: result1.last_id })
      );
      expect(result2.messages).toHaveLength(0);
    });
  });

  describe("send_message", () => {
    test("should send PROGRESS message to orchestrator", async () => {
      const result = JSON.parse(
        await workerHandlers.send_message({
          type: "PROGRESS",
          payload: JSON.stringify({
            status: "working",
            message: "Making progress",
          }),
        })
      );

      expect(result.success).toBe(true);
      expect(result.message_id).toBeDefined();

      // Verify message was sent
      const messages = await checkMessages("orche", "0");
      expect(messages.messages).toHaveLength(1);
      expect(messages.messages[0].type).toBe(MessageType.PROGRESS);
      expect(messages.messages[0].from).toBe("test-worker");
    });

    test("should send QUESTION message", async () => {
      const result = JSON.parse(
        await workerHandlers.send_message({
          type: "QUESTION",
          payload: JSON.stringify({
            question: "What should I do?",
          }),
        })
      );

      expect(result.success).toBe(true);

      const messages = await checkMessages("orche", "0");
      expect(messages.messages[0].type).toBe(MessageType.QUESTION);
    });

    test("should send REVIEW_REQUEST message", async () => {
      const result = JSON.parse(
        await workerHandlers.send_message({
          type: "REVIEW_REQUEST",
          payload: JSON.stringify({
            summary: "Implementation complete",
            files: ["file1.ts", "file2.ts"],
          }),
        })
      );

      expect(result.success).toBe(true);

      const messages = await checkMessages("orche", "0");
      expect(messages.messages[0].type).toBe(MessageType.REVIEW_REQUEST);
    });

    test("should return error for invalid JSON payload", async () => {
      const result = JSON.parse(
        await workerHandlers.send_message({
          type: "PROGRESS",
          payload: "invalid-json",
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON payload");
    });

    test("should auto-add task_id if not in payload", async () => {
      await workerHandlers.send_message({
        type: "PROGRESS",
        payload: JSON.stringify({
          status: "working",
          message: "Test",
        }),
      });

      const messages = await checkMessages("orche", "0");
      const payload = messages.messages[0].payload as { task_id?: string };
      expect(payload.task_id).toBe("test-task");
    });
  });

  describe("update_progress", () => {
    test("should send progress update", async () => {
      const result = JSON.parse(
        await workerHandlers.update_progress({
          status: "working",
          message: "Making progress",
        })
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Progress updated");

      // Verify message was sent to orchestrator
      const messages = await checkMessages("orche", "0");
      expect(messages.messages).toHaveLength(1);
      expect(messages.messages[0].type).toBe(MessageType.PROGRESS);

      const payload = messages.messages[0].payload as {
        task_id: string;
        status: string;
        message: string;
      };
      expect(payload.task_id).toBe("test-task");
      expect(payload.status).toBe("working");
      expect(payload.message).toBe("Making progress");
    });
  });

  describe("environment variable handling", () => {
    test("should throw error if WORKER_ID is not set", async () => {
      delete process.env.WORKER_ID;

      try {
        await workerHandlers.check_messages({});
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("WORKER_ID");
      }
    });

    test("should throw error if TASK_ID is not set for send_message", async () => {
      delete process.env.TASK_ID;

      try {
        await workerHandlers.send_message({
          type: "PROGRESS",
          payload: "{}",
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("TASK_ID");
      }
    });
  });
});
