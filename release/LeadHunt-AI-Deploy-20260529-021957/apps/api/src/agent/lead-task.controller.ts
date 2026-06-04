import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthService } from "../auth/auth.service.js";
import { readSessionCookie } from "../auth/session-cookie.js";
import { AgentWorkflowService } from "./agent-workflow.service.js";

const createLeadTaskSchema = z.object({
  prompt: z.string().trim().min(5),
  targetCount: z.number().int().min(1).max(500).optional()
});

const listLeadTaskSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["all", "active", "completed", "stopped"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const approveLeadTaskSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500).optional()
});

const rejectLeadTaskSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  reason: z.string().trim().max(500).optional()
});

const executeSearchSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  // 2026-05 Stage 2 follow-up: when set, the backend appends a fresh
  // batch of pending queries before running the worker pool if the
  // task has no pending/running queries left. Without this, /search
  // is a no-op for tasks that have already drained their queue
  // (the "继续搜索 30 条" button used to fire a 201 with
  // executedQueries=0).
  appendIfEmpty: z.boolean().optional()
});

@Controller("api/lead-tasks")
export class LeadTaskController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(AgentWorkflowService)
    private readonly agentWorkflowService: AgentWorkflowService
  ) {}

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = createLeadTaskSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid lead task payload");
    }

    return this.agentWorkflowService.createTaskWithTimeline(user.id, parsed.data);
  }

  @Get()
  async list(@Req() request: Request, @Query() query: Record<string, string>) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = listLeadTaskSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException("Invalid lead task list query");
    }

    return this.agentWorkflowService.listTasksForUser(user.id, parsed.data);
  }

  @Get(":taskId")
  async get(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.getTaskForUser(user.id, taskId);
  }

  @Get(":taskId/events")
  async events(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.getTaskEventsForUser(user.id, taskId);
  }

  @Get(":taskId/leads")
  async leads(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.getTaskLeadsForUser(user.id, taskId);
  }

  @Delete(":taskId")
  async delete(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.softDeleteTaskForUser(user.id, taskId);
  }

  @Post(":taskId/search")
  async executeSearch(@Req() request: Request, @Param("taskId") taskId: string, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = executeSearchSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Invalid lead search payload");
    }

    return this.agentWorkflowService.executeBraveSearchForTask(user.id, taskId, parsed.data);
  }

  @Post(":taskId/summary")
  async summary(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.summarizeTaskForUser(user.id, taskId);
  }

  @Post(":taskId/approve")
  async approve(@Req() request: Request, @Param("taskId") taskId: string, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = approveLeadTaskSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Invalid lead approval payload");
    }

    return this.agentWorkflowService.approveCandidatesForUser(user.id, taskId, parsed.data);
  }

  @Post(":taskId/reject")
  async reject(@Req() request: Request, @Param("taskId") taskId: string, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = rejectLeadTaskSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Invalid lead rejection payload");
    }

    return this.agentWorkflowService.rejectCandidatesForUser(user.id, taskId, parsed.data);
  }

  @Post(":taskId/pause")
  async pause(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.updateTaskStatusForUser(user.id, taskId, "paused");
  }

  @Post(":taskId/resume")
  async resume(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.updateTaskStatusForUser(user.id, taskId, "running");
  }

  @Post(":taskId/cancel")
  async cancel(@Req() request: Request, @Param("taskId") taskId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.agentWorkflowService.updateTaskStatusForUser(user.id, taskId, "cancelled");
  }
}
