// Message types
export const MessageType = {
  TASK_ASSIGN: "TASK_ASSIGN",
  PROGRESS: "PROGRESS",
  QUESTION: "QUESTION",
  ANSWER: "ANSWER",
  REVIEW_REQUEST: "REVIEW_REQUEST",
  REVIEW_RESULT: "REVIEW_RESULT",
  TASK_COMPLETE: "TASK_COMPLETE",
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

// Message payloads
export type TaskAssignPayload = {
  task_id: string;
  description: string;
  context?: string;
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
};

export type ReviewResultPayload = {
  task_id: string;
  approved: boolean;
  feedback?: string;
};

export type TaskCompletePayload = {
  task_id: string;
};

export type MessagePayload =
  | TaskAssignPayload
  | ProgressPayload
  | QuestionPayload
  | AnswerPayload
  | ReviewRequestPayload
  | ReviewResultPayload
  | TaskCompletePayload;

// Base message structure
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
export type Role = "orche" | "worker";
