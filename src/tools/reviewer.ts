import { z } from "zod";
import * as db from "../lib/db.js";
import { EventType } from "../types.js";
import type {
  ReviewRequestedEventPayload,
  ReviewApprovedEventPayload,
  ReviewDeniedEventPayload,
} from "../types.js";

// Tool definitions for reviewer
export const reviewerTools = [
  {
    name: "check_review_requests",
    description:
      "Check for review-requested events. Call this regularly to find PRs that need review.",
    inputSchema: z.object({}),
  },
  {
    name: "approve_review",
    description: "Approve a PR and register review-approved event",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID"),
    }),
  },
  {
    name: "deny_review",
    description: "Deny a PR with feedback and register review-denied event",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID"),
      feedback: z.string().describe("Feedback for the worker on what needs to be fixed"),
    }),
  },
  {
    name: "get_task_info",
    description: "Get detailed information about a task including PR URL",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID to get info for"),
    }),
  },
] as const;

// Tool handlers
export const reviewerHandlers = {
  async check_review_requests(): Promise<string> {
    // Get all unprocessed review-requested events
    const events = await db.getUnprocessedEvents();
    const reviewRequestedEvents = events.filter(
      (e) => e.type === EventType.REVIEW_REQUESTED
    );

    return JSON.stringify({
      success: true,
      events: reviewRequestedEvents.map((e) => {
        const payload = e.payload as ReviewRequestedEventPayload;
        return {
          id: e.id,
          task_id: e.task_id,
          pr_url: payload.pr_url,
          summary: payload.summary,
          timestamp: new Date(e.timestamp).toISOString(),
        };
      }),
      count: reviewRequestedEvents.length,
    });
  },

  async approve_review(params: { task_id: string }): Promise<string> {
    // Register review-approved event
    const payload: ReviewApprovedEventPayload = {
      task_id: params.task_id,
    };

    const eventId = await db.registerEvent(
      EventType.REVIEW_APPROVED,
      params.task_id,
      payload
    );

    // Mark the review-requested event as processed
    const reviewRequestedEvent = await db.getLatestUnprocessedEvent(
      params.task_id,
      EventType.REVIEW_REQUESTED
    );
    if (reviewRequestedEvent) {
      await db.markEventProcessed(reviewRequestedEvent.id);
    }

    return JSON.stringify({
      success: true,
      event_id: eventId,
      message: `Review approved for task ${params.task_id}`,
    });
  },

  async deny_review(params: {
    task_id: string;
    feedback: string;
  }): Promise<string> {
    // Register review-denied event
    const payload: ReviewDeniedEventPayload = {
      task_id: params.task_id,
      feedback: params.feedback,
    };

    const eventId = await db.registerEvent(
      EventType.REVIEW_DENIED,
      params.task_id,
      payload
    );

    // Mark the review-requested event as processed
    const reviewRequestedEvent = await db.getLatestUnprocessedEvent(
      params.task_id,
      EventType.REVIEW_REQUESTED
    );
    if (reviewRequestedEvent) {
      await db.markEventProcessed(reviewRequestedEvent.id);
    }

    return JSON.stringify({
      success: true,
      event_id: eventId,
      message: `Review denied for task ${params.task_id} with feedback`,
    });
  },

  async get_task_info(params: { task_id: string }): Promise<string> {
    const task = await db.getTask(params.task_id);

    if (!task) {
      return JSON.stringify({
        success: false,
        error: `Task ${params.task_id} not found`,
      });
    }

    return JSON.stringify({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        description: task.description,
        context: task.context,
        pr_url: task.pr_url,
        worker_id: task.worker_id,
        created_at: new Date(task.created_at).toISOString(),
        updated_at: new Date(task.updated_at).toISOString(),
      },
    });
  },
};
