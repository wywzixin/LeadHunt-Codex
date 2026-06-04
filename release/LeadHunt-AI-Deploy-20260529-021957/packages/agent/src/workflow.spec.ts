import { describe, expect, it } from "vitest";
import {
  Command,
  INTERRUPT,
  MemorySaver,
  createLeadHuntWorkflowGraph,
  createInitialWorkflowSteps,
  createInitialWorkflowState,
  interrupt,
  leadHuntWorkflowNodes,
  markWorkflowNodeFailed,
  resumeWorkflow,
  retryWorkflowNode,
  runEmptyLeadHuntWorkflow
} from "./index.js";

describe("LeadHunt LangGraph workflow", () => {
  it("creates the V1 workflow timeline", () => {
    const steps = createInitialWorkflowSteps();

    expect(steps).toHaveLength(16);
    expect(steps.map((step) => step.nodeName)).toEqual(leadHuntWorkflowNodes);
  });

  it("runs the empty LangGraph flow until the human approval pause", async () => {
    const state = await runEmptyLeadHuntWorkflow("task-1");

    expect(state.status).toBe("paused");
    expect(state.pausedAt).toBe("human_approval");
    expect(state.steps.find((step) => step.nodeName === "load_task")?.status).toBe("completed");
    expect(state.steps.find((step) => step.nodeName === "human_approval")?.status).toBe("waiting");
    expect(state.steps.find((step) => step.nodeName === "generate_email")?.status).toBe("pending");
  });

  it("supports resume from a human approval pause", async () => {
    const paused = await runEmptyLeadHuntWorkflow("task-1");
    const resumed = resumeWorkflow(paused);

    expect(resumed.status).toBe("running");
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.steps.find((step) => step.nodeName === "human_approval")?.status).toBe("completed");
  });

  it("supports failed node state and retry", () => {
    const failed = markWorkflowNodeFailed(
      {
        taskId: "task-1",
        status: "running",
        currentNode: null,
        pausedAt: null,
        steps: createInitialWorkflowSteps(),
        error: null
      },
      "brave_search",
      "Brave timeout"
    );
    const retrying = retryWorkflowNode(failed, "brave_search");

    expect(failed.status).toBe("failed");
    expect(failed.steps.find((step) => step.nodeName === "brave_search")?.status).toBe("failed");
    expect(retrying.status).toBe("running");
    expect(retrying.steps.find((step) => step.nodeName === "brave_search")?.status).toBe("running");
  });

  it("runs injected handlers from a chosen start node", async () => {
    const calls: string[] = [];
    const graph = createLeadHuntWorkflowGraph({
      startAt: "generate_email",
      handlers: {
        generate_email: () => {
          calls.push("generate_email");
          return {
            currentNode: "generate_email",
            steps: [
              {
                nodeName: "generate_email",
                order: 11,
                status: "completed",
                output: { draftCount: 1 }
              }
            ]
          };
        },
        wait_email_confirmation: () => {
          calls.push("wait_email_confirmation");
          return {
            status: "paused",
            currentNode: "wait_email_confirmation",
            pausedAt: "wait_email_confirmation",
            steps: [
              {
                nodeName: "wait_email_confirmation",
                order: 12,
                status: "waiting",
                output: { waitingForHuman: true }
              }
            ]
          };
        }
      }
    });

    const state = (await graph.invoke(createInitialWorkflowState("task-1") as Record<string, unknown>)) as any;

    expect(calls).toEqual(["generate_email", "wait_email_confirmation"]);
    expect(state.status).toBe("paused");
    expect(state.pausedAt).toBe("wait_email_confirmation");
    expect(state.steps.find((step: { nodeName: string }) => step.nodeName === "generate_email")?.status).toBe("completed");
    expect(state.steps.find((step: { nodeName: string }) => step.nodeName === "wait_email_confirmation")?.status).toBe(
      "waiting"
    );
  });

  it("lets native LangGraph interrupts pause and resume with a checkpointer", async () => {
    const graph = createLeadHuntWorkflowGraph({
      startAt: "human_approval",
      checkpointer: new MemorySaver(),
      handlers: {
        human_approval: () => {
          const decision = interrupt({ type: "lead_review", taskId: "task-1" }) as { approved: boolean };

          return {
            currentNode: "human_approval",
            steps: [
              {
                nodeName: "human_approval",
                order: 10,
                status: "completed",
                output: decision
              }
            ]
          };
        }
      },
      stopAfter: "human_approval"
    });
    const config = { configurable: { thread_id: "task-1" } };

    const interrupted = (await graph.invoke(createInitialWorkflowState("task-1") as Record<string, unknown>, config)) as any;
    expect(interrupted[INTERRUPT][0].value).toEqual({ type: "lead_review", taskId: "task-1" });

    const resumed = (await graph.invoke(new Command({ resume: { approved: true } }), config)) as any;
    expect(resumed.steps.find((step: { nodeName: string }) => step.nodeName === "human_approval")?.output).toEqual({
      approved: true
    });
  });
});
