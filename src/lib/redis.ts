import Redis from "ioredis";
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

// Redis keys
export const Keys = {
  streamOrche: "stream:orche",
  streamWorker: (workerId: string) => `stream:worker:${workerId}`,
  task: (taskId: string) => `task:${taskId}`,
  worker: (workerId: string) => `worker:${workerId}`,
  workerAlive: (workerId: string) => `worker:${workerId}:alive`,
  workersActive: "workers:active",
} as const;

// Heartbeat TTL in seconds
const HEARTBEAT_TTL = 30;

// Redis client singleton
let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: 3,
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// Message operations
export async function sendMessage(
  to: string,
  from: string,
  type: MessageType,
  payload: MessagePayload
): Promise<string> {
  const r = getRedis();
  const message: Message = {
    id: uuidv4(),
    timestamp: Date.now(),
    from,
    to,
    type,
    payload,
  };

  const streamKey = to === "orche" ? Keys.streamOrche : Keys.streamWorker(to);

  await r.xadd(
    streamKey,
    "*",
    "id",
    message.id,
    "timestamp",
    message.timestamp.toString(),
    "from",
    message.from,
    "to",
    message.to,
    "type",
    message.type,
    "payload",
    JSON.stringify(message.payload)
  );

  return message.id;
}

export async function checkMessages(
  recipient: string,
  lastId: string = "0"
): Promise<{ messages: Message[]; lastId: string }> {
  const r = getRedis();
  const streamKey =
    recipient === "orche" ? Keys.streamOrche : Keys.streamWorker(recipient);

  const results = await r.xread("COUNT", 100, "STREAMS", streamKey, lastId);

  if (!results || results.length === 0) {
    return { messages: [], lastId };
  }

  const messages: Message[] = [];
  let newLastId = lastId;

  for (const [, entries] of results) {
    for (const [id, fields] of entries) {
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldMap[fields[i]] = fields[i + 1];
      }

      messages.push({
        id: fieldMap.id,
        timestamp: parseInt(fieldMap.timestamp),
        from: fieldMap.from,
        to: fieldMap.to,
        type: fieldMap.type as MessageType,
        payload: JSON.parse(fieldMap.payload),
      });

      newLastId = id;
    }
  }

  return { messages, lastId: newLastId };
}

// Task operations
export async function createTask(
  taskId: string,
  description: string,
  context?: string
): Promise<Task> {
  const r = getRedis();
  const now = Date.now();
  const task: Task = {
    id: taskId,
    status: "pending",
    description,
    context,
    created_at: now,
    updated_at: now,
  };

  await r.hset(Keys.task(taskId), {
    id: task.id,
    status: task.status,
    description: task.description,
    context: task.context || "",
    created_at: task.created_at.toString(),
    updated_at: task.updated_at.toString(),
  });

  return task;
}

export async function getTask(taskId: string): Promise<Task | null> {
  const r = getRedis();
  const data = await r.hgetall(Keys.task(taskId));

  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  return {
    id: data.id,
    status: data.status as TaskStatus,
    worker_id: data.worker_id || undefined,
    description: data.description,
    context: data.context || undefined,
    created_at: parseInt(data.created_at),
    updated_at: parseInt(data.updated_at),
  };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  workerId?: string
): Promise<void> {
  const r = getRedis();
  const updates: Record<string, string> = {
    status,
    updated_at: Date.now().toString(),
  };

  if (workerId !== undefined) {
    updates.worker_id = workerId;
  }

  await r.hset(Keys.task(taskId), updates);
}

// Worker operations
export async function registerWorker(
  workerId: string,
  paneId?: string
): Promise<Worker> {
  const r = getRedis();
  const now = Date.now();
  const worker: Worker = {
    id: workerId,
    status: "idle",
    last_heartbeat: now,
    pane_id: paneId,
  };

  await r.hset(Keys.worker(workerId), {
    id: worker.id,
    status: worker.status,
    last_heartbeat: worker.last_heartbeat.toString(),
    pane_id: worker.pane_id || "",
  });

  await r.sadd(Keys.workersActive, workerId);
  await r.set(Keys.workerAlive(workerId), "1", "EX", HEARTBEAT_TTL);

  return worker;
}

export async function updateWorkerHeartbeat(workerId: string): Promise<void> {
  const r = getRedis();
  await r.hset(Keys.worker(workerId), "last_heartbeat", Date.now().toString());
  await r.set(Keys.workerAlive(workerId), "1", "EX", HEARTBEAT_TTL);
}

export async function updateWorkerStatus(
  workerId: string,
  status: WorkerStatus,
  taskId?: string
): Promise<void> {
  const r = getRedis();
  const updates: Record<string, string> = {
    status,
    last_heartbeat: Date.now().toString(),
  };

  if (taskId !== undefined) {
    updates.task_id = taskId;
  }

  await r.hset(Keys.worker(workerId), updates);
  await r.set(Keys.workerAlive(workerId), "1", "EX", HEARTBEAT_TTL);
}

export async function getWorker(workerId: string): Promise<Worker | null> {
  const r = getRedis();
  const data = await r.hgetall(Keys.worker(workerId));

  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  return {
    id: data.id,
    status: data.status as WorkerStatus,
    task_id: data.task_id || undefined,
    last_heartbeat: parseInt(data.last_heartbeat),
    pane_id: data.pane_id || undefined,
  };
}

export async function listActiveWorkers(): Promise<Worker[]> {
  const r = getRedis();
  const workerIds = await r.smembers(Keys.workersActive);
  const workers: Worker[] = [];

  for (const workerId of workerIds) {
    const worker = await getWorker(workerId);
    if (worker) {
      // Check if worker is still alive
      const alive = await r.exists(Keys.workerAlive(workerId));
      if (alive) {
        workers.push(worker);
      } else {
        // Remove dead worker from active set
        await r.srem(Keys.workersActive, workerId);
      }
    }
  }

  return workers;
}

export async function removeWorker(workerId: string): Promise<void> {
  const r = getRedis();
  await r.del(Keys.worker(workerId));
  await r.del(Keys.workerAlive(workerId));
  await r.del(Keys.streamWorker(workerId));
  await r.srem(Keys.workersActive, workerId);
}
