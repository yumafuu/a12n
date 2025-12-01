// Event types for event-driven architecture
export const EventType = {
  TASK_CREATE: "task-create",
  REVIEW_REQUESTED: "review-requested",
  REVIEW_APPROVED: "review-approved",
  REVIEW_DENIED: "review-denied",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

// Legacy message types (kept for backward compatibility during migration)
export const MessageType = {
  TASK_ASSIGN: "TASK_ASSIGN",
  PROGRESS: "PROGRESS",
  QUESTION: "QUESTION",
  ANSWER: "ANSWER",
  REVIEW_REQUEST: "REVIEW_REQUEST",
  REVIEW_RESULT: "REVIEW_RESULT",
  TASK_COMPLETE: "TASK_COMPLETE",
  EMERGENCY_STOP: "EMERGENCY_STOP",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// Task status
export const TaskStatus = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

// Worker status
export const WorkerStatus = {
  RUNNING: "running",
  IDLE: "idle",
} as const;

export type WorkerStatus = (typeof WorkerStatus)[keyof typeof WorkerStatus];

// Event payloads for event-driven architecture
export type TaskCreateEventPayload = {
  task_id: string;
  description: string;
  context?: string;
  branch_name: string;
};

export type ReviewRequestedEventPayload = {
  task_id: string;
  pr_url: string;
  summary: string;
};

export type ReviewApprovedEventPayload = {
  task_id: string;
};

export type ReviewDeniedEventPayload = {
  task_id: string;
  feedback: string;
};

export type EventPayload =
  | TaskCreateEventPayload
  | ReviewRequestedEventPayload
  | ReviewApprovedEventPayload
  | ReviewDeniedEventPayload;

// Legacy message payloads (kept for backward compatibility)
export type TaskAssignPayload = {
  task_id: string;
  description: string;
  context?: string;
  worktree_path?: string;
  branch_name?: string;
};

export type ProgressPayload = {
  task_id: string;
  status: string;
  message: string;
};

export type QuestionPayload = {
  task_id: string;
  question: string;
};

export type AnswerPayload = {
  task_id: string;
  answer: string;
};

export type ReviewRequestPayload = {
  task_id: string;
  summary: string;
  files?: string[];
  pr_url?: string;
};

export type ReviewResultPayload = {
  task_id: string;
  approved: boolean;
  feedback?: string;
};

export type TaskCompletePayload = {
  task_id: string;
};

export type EmergencyStopPayload = {
  task_id: string;
  reason: string;
};

export type MessagePayload =
  | TaskAssignPayload
  | ProgressPayload
  | QuestionPayload
  | AnswerPayload
  | ReviewRequestPayload
  | ReviewResultPayload
  | TaskCompletePayload
  | EmergencyStopPayload;

// Event structure for event-driven architecture
export type Event = {
  id: string;
  seq: number;
  timestamp: number;
  type: EventType;
  task_id: string;
  payload: EventPayload;
  processed: boolean;
};

// Base message structure (legacy)
export type Message = {
  id: string;
  timestamp: number;
  from: string;
  to: string;
  type: MessageType;
  payload: MessagePayload;
};

// Task structure
export type Task = {
  id: string;
  status: TaskStatus;
  worker_id?: string;
  description: string;
  context?: string;
  worktree_path?: string;
  branch_name?: string;
  pr_url?: string;
  created_at: number;
  updated_at: number;
};

// Worker structure
export type Worker = {
  id: string;
  status: WorkerStatus;
  task_id?: string;
  last_heartbeat: number;
  pane_id?: string;
};

// Role
export type Role = "planner" | "orche" | "reviewer" | "worker";
