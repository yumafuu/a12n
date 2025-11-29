import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlink } from "fs/promises";
import {
  getDb,
  closeDb,
  sendMessage,
  checkMessages,
  createTask,
  getTask,
  updateTaskStatus,
  registerWorker,
  updateWorkerHeartbeat,
  updateWorkerStatus,
  getWorker,
  listActiveWorkers,
  removeWorker,
} from "../lib/db.js";
import { MessageType, TaskStatus } from "../types.js";

const TEST_DB_PATH = "test-aiorchestration.db";

describe("db", () => {
  beforeEach(() => {
    // Set test database path
    process.env.DB_PATH = TEST_DB_PATH;
    // Initialize database
    getDb();
  });

  afterEach(async () => {
    // Close database
    closeDb();
    // Remove test database file
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe("sendMessage and checkMessages", () => {
    test("should send and receive messages", async () => {
      const messageId = await sendMessage(
        "worker-1",
        "orche",
        MessageType.TASK_ASSIGN,
        {
          task_id: "task-1",
          description: "Test task",
        }
      );

      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe("string");

      const result = await checkMessages("worker-1", "0");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe(MessageType.TASK_ASSIGN);
      expect(result.messages[0].from).toBe("orche");
      expect(result.messages[0].to).toBe("worker-1");
    });

    test("should paginate messages correctly", async () => {
      // Send multiple messages
      await sendMessage("worker-1", "orche", MessageType.TASK_ASSIGN, {
        task_id: "task-1",
        description: "Task 1",
      });
      await sendMessage("worker-1", "orche", MessageType.PROGRESS, {
        task_id: "task-1",
        status: "working",
        message: "Progress update",
      });

      // Get first message
      const result1 = await checkMessages("worker-1", "0");
      expect(result1.messages).toHaveLength(2);

      // Get with last ID should return empty
      const result2 = await checkMessages("worker-1", result1.lastId);
      expect(result2.messages).toHaveLength(0);
    });

    test("should only return messages for the specified recipient", async () => {
      await sendMessage("worker-1", "orche", MessageType.TASK_ASSIGN, {
        task_id: "task-1",
        description: "Task 1",
      });
      await sendMessage("worker-2", "orche", MessageType.TASK_ASSIGN, {
        task_id: "task-2",
        description: "Task 2",
      });

      const result1 = await checkMessages("worker-1", "0");
      expect(result1.messages).toHaveLength(1);
      expect((result1.messages[0].payload as { task_id: string }).task_id).toBe("task-1");

      const result2 = await checkMessages("worker-2", "0");
      expect(result2.messages).toHaveLength(1);
      expect((result2.messages[0].payload as { task_id: string }).task_id).toBe("task-2");
    });
  });

  describe("createTask and getTask", () => {
    test("should create and retrieve a task", async () => {
      const task = await createTask("task-1", "Test description", "Test context");

      expect(task.id).toBe("task-1");
      expect(task.description).toBe("Test description");
      expect(task.context).toBe("Test context");
      expect(task.status).toBe("pending");

      const retrieved = await getTask("task-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("task-1");
      expect(retrieved?.description).toBe("Test description");
    });

    test("should return null for non-existent task", async () => {
      const result = await getTask("non-existent");
      expect(result).toBeNull();
    });

    test("should create task without context", async () => {
      const task = await createTask("task-2", "No context task");
      expect(task.context).toBeUndefined();
    });
  });

  describe("updateTaskStatus", () => {
    test("should update task status", async () => {
      await createTask("task-1", "Test task");

      await updateTaskStatus("task-1", TaskStatus.IN_PROGRESS);
      let task = await getTask("task-1");
      expect(task?.status).toBe(TaskStatus.IN_PROGRESS);

      await updateTaskStatus("task-1", TaskStatus.COMPLETED);
      task = await getTask("task-1");
      expect(task?.status).toBe(TaskStatus.COMPLETED);
    });

    test("should update task status with worker ID", async () => {
      await createTask("task-1", "Test task");

      await updateTaskStatus("task-1", TaskStatus.IN_PROGRESS, "worker-1");
      const task = await getTask("task-1");
      expect(task?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(task?.worker_id).toBe("worker-1");
    });
  });

  describe("registerWorker and getWorker", () => {
    test("should register and retrieve a worker", async () => {
      const worker = await registerWorker("worker-1", "%1");

      expect(worker.id).toBe("worker-1");
      expect(worker.status).toBe("idle");
      expect(worker.pane_id).toBe("%1");

      const retrieved = await getWorker("worker-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("worker-1");
    });

    test("should return null for non-existent worker", async () => {
      const result = await getWorker("non-existent");
      expect(result).toBeNull();
    });

    test("should register worker without pane_id", async () => {
      const worker = await registerWorker("worker-2");
      expect(worker.pane_id).toBeUndefined();
    });
  });

  describe("updateWorkerHeartbeat", () => {
    test("should update worker heartbeat", async () => {
      await registerWorker("worker-1");
      const before = await getWorker("worker-1");
      const beforeHeartbeat = before?.last_heartbeat;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      await updateWorkerHeartbeat("worker-1");
      const after = await getWorker("worker-1");

      expect(after?.last_heartbeat).toBeGreaterThan(beforeHeartbeat!);
    });
  });

  describe("updateWorkerStatus", () => {
    test("should update worker status", async () => {
      await registerWorker("worker-1");

      await updateWorkerStatus("worker-1", "running");
      let worker = await getWorker("worker-1");
      expect(worker?.status).toBe("running");

      await updateWorkerStatus("worker-1", "idle");
      worker = await getWorker("worker-1");
      expect(worker?.status).toBe("idle");
    });

    test("should update worker status with task ID", async () => {
      await registerWorker("worker-1");

      await updateWorkerStatus("worker-1", "running", "task-1");
      const worker = await getWorker("worker-1");
      expect(worker?.status).toBe("running");
      expect(worker?.task_id).toBe("task-1");
    });
  });

  describe("listActiveWorkers", () => {
    test("should list active workers", async () => {
      await registerWorker("worker-1");
      await registerWorker("worker-2");

      const workers = await listActiveWorkers();
      expect(workers).toHaveLength(2);
    });

    test("should not list workers with stale heartbeat", async () => {
      await registerWorker("worker-1");

      // Manually set old heartbeat
      const db = getDb();
      const oldTime = Date.now() - 60000; // 1 minute ago
      db.run(`UPDATE workers SET last_heartbeat = ? WHERE id = ?`, [
        oldTime,
        "worker-1",
      ]);

      const workers = await listActiveWorkers();
      expect(workers).toHaveLength(0);
    });
  });

  describe("removeWorker", () => {
    test("should remove a worker", async () => {
      await registerWorker("worker-1");

      let worker = await getWorker("worker-1");
      expect(worker).not.toBeNull();

      await removeWorker("worker-1");

      worker = await getWorker("worker-1");
      expect(worker).toBeNull();
    });

    test("should remove messages to the worker", async () => {
      await registerWorker("worker-1");
      await sendMessage("worker-1", "orche", MessageType.TASK_ASSIGN, {
        task_id: "task-1",
        description: "Test",
      });

      let result = await checkMessages("worker-1", "0");
      expect(result.messages).toHaveLength(1);

      await removeWorker("worker-1");

      result = await checkMessages("worker-1", "0");
      expect(result.messages).toHaveLength(0);
    });
  });
});
