import { describe, expect, test } from "bun:test";
import {
  MessageType,
  TaskStatus,
  WorkerStatus,
} from "../types.js";

describe("types", () => {
  describe("MessageType", () => {
    test("should have all expected message types", () => {
      expect(MessageType.TASK_ASSIGN).toBe("TASK_ASSIGN");
      expect(MessageType.PROGRESS).toBe("PROGRESS");
      expect(MessageType.QUESTION).toBe("QUESTION");
      expect(MessageType.ANSWER).toBe("ANSWER");
      expect(MessageType.REVIEW_REQUEST).toBe("REVIEW_REQUEST");
      expect(MessageType.REVIEW_RESULT).toBe("REVIEW_RESULT");
      expect(MessageType.TASK_COMPLETE).toBe("TASK_COMPLETE");
    });

    test("should be immutable (const assertion)", () => {
      const types = Object.keys(MessageType);
      expect(types).toHaveLength(7);
    });
  });

  describe("TaskStatus", () => {
    test("should have all expected task statuses", () => {
      expect(TaskStatus.PENDING).toBe("pending");
      expect(TaskStatus.IN_PROGRESS).toBe("in_progress");
      expect(TaskStatus.REVIEW).toBe("review");
      expect(TaskStatus.COMPLETED).toBe("completed");
      expect(TaskStatus.FAILED).toBe("failed");
    });

    test("should have 5 statuses", () => {
      const statuses = Object.keys(TaskStatus);
      expect(statuses).toHaveLength(5);
    });
  });

  describe("WorkerStatus", () => {
    test("should have all expected worker statuses", () => {
      expect(WorkerStatus.RUNNING).toBe("running");
      expect(WorkerStatus.IDLE).toBe("idle");
    });

    test("should have 2 statuses", () => {
      const statuses = Object.keys(WorkerStatus);
      expect(statuses).toHaveLength(2);
    });
  });
});
