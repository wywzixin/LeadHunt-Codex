import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { LeadTaskController } from "./lead-task.controller.js";

function requestWithCookie(): Request {
  return {
    headers: {
      cookie: "lh_session=session-1.token-1"
    }
  } as Request;
}

function createController() {
  const authService = {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "user-1",
        email: "buyer@example.com"
      }
    })
  };
  const workflowService = {
    createTaskWithTimeline: vi.fn().mockResolvedValue({
      task: { id: "task-1" },
      steps: []
    }),
    getTaskForUser: vi.fn().mockResolvedValue({ id: "task-1" }),
    getTaskEventsForUser: vi.fn().mockResolvedValue([]),
    getTaskLeadsForUser: vi.fn().mockResolvedValue([]),
    executeBraveSearchForTask: vi.fn().mockResolvedValue({ ok: true, executedQueries: 1 }),
    summarizeTaskForUser: vi.fn().mockResolvedValue({ ok: true, summary: { did: [] } }),
    approveCandidatesForUser: vi.fn().mockResolvedValue({ ok: true, approvedCount: 1, draftCount: 1 }),
    updateTaskStatusForUser: vi.fn().mockResolvedValue({ id: "task-1", status: "paused" })
  };

  return {
    controller: new LeadTaskController(authService as any, workflowService as any),
    authService,
    workflowService
  };
}

describe("LeadTaskController", () => {
  it("creates an authenticated lead task", async () => {
    const { controller, workflowService } = createController();

    const result = await controller.create(requestWithCookie(), {
      prompt: "Find UAE telecom distributors",
      targetCount: 20
    });

    expect(result.task.id).toBe("task-1");
    expect(workflowService.createTaskWithTimeline).toHaveBeenCalledWith("user-1", {
      prompt: "Find UAE telecom distributors",
      targetCount: 20
    });
  });

  it("rejects invalid create payloads", async () => {
    const { controller } = createController();

    await expect(controller.create(requestWithCookie(), { prompt: "bad" })).rejects.toThrow(
      BadRequestException
    );
  });

  it("returns task details, events, leads, and status commands for the current user", async () => {
    const { controller, workflowService } = createController();

    await controller.get(requestWithCookie(), "task-1");
    await controller.events(requestWithCookie(), "task-1");
    await controller.leads(requestWithCookie(), "task-1");
    await controller.executeSearch(requestWithCookie(), "task-1", { limit: 1 });
    await controller.summary(requestWithCookie(), "task-1");
    await controller.approve(requestWithCookie(), "task-1", {
      leadIds: ["11111111-1111-4111-8111-111111111111"]
    });
    await controller.pause(requestWithCookie(), "task-1");
    await controller.resume(requestWithCookie(), "task-1");
    await controller.cancel(requestWithCookie(), "task-1");

    expect(workflowService.getTaskForUser).toHaveBeenCalledWith("user-1", "task-1");
    expect(workflowService.getTaskEventsForUser).toHaveBeenCalledWith("user-1", "task-1");
    expect(workflowService.getTaskLeadsForUser).toHaveBeenCalledWith("user-1", "task-1");
    expect(workflowService.executeBraveSearchForTask).toHaveBeenCalledWith("user-1", "task-1", { limit: 1 });
    expect(workflowService.summarizeTaskForUser).toHaveBeenCalledWith("user-1", "task-1");
    expect(workflowService.approveCandidatesForUser).toHaveBeenCalledWith("user-1", "task-1", {
      leadIds: ["11111111-1111-4111-8111-111111111111"]
    });
    expect(workflowService.updateTaskStatusForUser).toHaveBeenCalledWith(
      "user-1",
      "task-1",
      "cancelled"
    );
  });

  it("rejects invalid candidate approval payloads", async () => {
    const { controller, workflowService } = createController();

    await expect(controller.approve(requestWithCookie(), "task-1", { leadIds: ["not-a-uuid"] })).rejects.toThrow(
      BadRequestException
    );
    expect(workflowService.approveCandidatesForUser).not.toHaveBeenCalled();
  });

  it("rejects invalid search execution payloads", async () => {
    const { controller, workflowService } = createController();

    await expect(controller.executeSearch(requestWithCookie(), "task-1", { limit: 30 })).rejects.toThrow(BadRequestException);
    expect(workflowService.executeBraveSearchForTask).not.toHaveBeenCalled();
  });
});
