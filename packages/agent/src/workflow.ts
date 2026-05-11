import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

export const leadHuntWorkflowNodes = [
  "load_task",
  "analyze_product_profile",
  "analyze_customer_profile",
  "expand_keywords",
  "plan_search_queries",
  "brave_search",
  "normalize_leads",
  "extract_contacts",
  "score_icp",
  "human_approval",
  "generate_email",
  "wait_email_confirmation",
  "send_gmail",
  "sync_crm",
  "schedule_followup",
  "task_summary"
] as const;

export type LeadHuntWorkflowNode = (typeof leadHuntWorkflowNodes)[number];

export type WorkflowRunStatus = "running" | "paused" | "completed" | "failed";

export type WorkflowStepStatus = "pending" | "running" | "completed" | "waiting" | "failed";

export type WorkflowStep = {
  nodeName: LeadHuntWorkflowNode;
  order: number;
  status: WorkflowStepStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
};

export type LeadHuntWorkflowState = {
  taskId: string;
  status: WorkflowRunStatus;
  currentNode: LeadHuntWorkflowNode | null;
  pausedAt: LeadHuntWorkflowNode | null;
  steps: WorkflowStep[];
  error: string | null;
};

export const humanApprovalNodes = ["human_approval", "wait_email_confirmation"] as const;

export type LeadHuntWorkflowNodeResult = Partial<LeadHuntWorkflowState>;

export type LeadHuntWorkflowNodeHandler = (
  state: LeadHuntWorkflowState
) => LeadHuntWorkflowNodeResult | Promise<LeadHuntWorkflowNodeResult>;

export type LeadHuntWorkflowHandlers = Partial<Record<LeadHuntWorkflowNode, LeadHuntWorkflowNodeHandler>>;

export type LeadHuntWorkflowGraphOptions = {
  handlers?: LeadHuntWorkflowHandlers;
  startAt?: LeadHuntWorkflowNode;
  stopAfter?: LeadHuntWorkflowNode;
};

const LeadHuntState = Annotation.Root({
  taskId: Annotation<string>,
  status: Annotation<WorkflowRunStatus>({
    reducer: (_, update) => update,
    default: () => "running"
  }),
  currentNode: Annotation<LeadHuntWorkflowNode | null>({
    reducer: (_, update) => update,
    default: () => null
  }),
  pausedAt: Annotation<LeadHuntWorkflowNode | null>({
    reducer: (_, update) => update,
    default: () => null
  }),
  steps: Annotation<WorkflowStep[]>({
    reducer: (current, update) => mergeWorkflowSteps(current, update),
    default: () => []
  }),
  error: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null
  })
});

export function createInitialWorkflowSteps(): WorkflowStep[] {
  return leadHuntWorkflowNodes.map((nodeName, index) => ({
    nodeName,
    order: index + 1,
    status: "pending"
  }));
}

export function createInitialWorkflowState(taskId: string): LeadHuntWorkflowState {
  return {
    taskId,
    status: "running",
    currentNode: null,
    pausedAt: null,
    steps: createInitialWorkflowSteps(),
    error: null
  };
}

export function createLeadHuntWorkflowGraph(options: LeadHuntWorkflowGraphOptions = {}) {
  const graph = new StateGraph(LeadHuntState) as any;
  const startNode = options.startAt ?? "load_task";
  const startIndex = leadHuntWorkflowNodes.indexOf(startNode);

  for (const nodeName of leadHuntWorkflowNodes.slice(startIndex)) {
    graph.addNode(nodeName, createWorkflowNode(nodeName, options.handlers?.[nodeName]));
  }

  graph.addEdge(START, startNode);
  for (let index = startIndex; index < leadHuntWorkflowNodes.length - 1; index += 1) {
    const current = leadHuntWorkflowNodes[index]!;
    const next = leadHuntWorkflowNodes[index + 1]!;
    graph.addConditionalEdges(
      current,
      (state: LeadHuntWorkflowState) => {
        if (state.status === "failed" || state.status === "completed") {
          return END;
        }

        if (options.stopAfter === current) {
          return END;
        }

        if (
          humanApprovalNodes.includes(current as (typeof humanApprovalNodes)[number]) &&
          state.status === "paused"
        ) {
          return END;
        }

        return next;
      },
      {
        [END]: END,
        [next]: next
      }
    );
  }
  graph.addEdge("task_summary", END);

  return graph.compile();
}

export async function runEmptyLeadHuntWorkflow(taskId: string) {
  return createLeadHuntWorkflowGraph().invoke(
    createInitialWorkflowState(taskId) as Record<string, unknown>
  ) as Promise<LeadHuntWorkflowState>;
}

export function resumeWorkflow(state: LeadHuntWorkflowState): LeadHuntWorkflowState {
  if (state.status !== "paused" || !state.pausedAt) {
    return state;
  }

  return {
    ...state,
    status: "running",
    pausedAt: null,
    steps: mergeWorkflowSteps(state.steps, [
      {
        nodeName: state.pausedAt,
        order: nodeOrder(state.pausedAt),
        status: "completed",
        output: { resumed: true }
      }
    ])
  };
}

export function markWorkflowNodeFailed(
  state: LeadHuntWorkflowState,
  nodeName: LeadHuntWorkflowNode,
  error: string
): LeadHuntWorkflowState {
  return {
    ...state,
    status: "failed",
    currentNode: nodeName,
    error,
    steps: mergeWorkflowSteps(state.steps, [
      {
        nodeName,
        order: nodeOrder(nodeName),
        status: "failed",
        error
      }
    ])
  };
}

export function retryWorkflowNode(state: LeadHuntWorkflowState, nodeName: LeadHuntWorkflowNode) {
  return {
    ...state,
    status: "running" as const,
    currentNode: nodeName,
    error: null,
    steps: mergeWorkflowSteps(state.steps, [
      {
        nodeName,
        order: nodeOrder(nodeName),
        status: "running",
        output: { retry: true }
      }
    ])
  };
}

function createWorkflowNode(nodeName: LeadHuntWorkflowNode, handler?: LeadHuntWorkflowNodeHandler) {
  if (!handler) {
    return createEmptyWorkflowNode(nodeName);
  }

  return async (state: LeadHuntWorkflowState) => {
    try {
      return await handler(state);
    } catch (error) {
      return markWorkflowNodeFailed(state, nodeName, errorMessage(error));
    }
  };
}

function createEmptyWorkflowNode(nodeName: LeadHuntWorkflowNode) {
  return async () => {
    if (humanApprovalNodes.includes(nodeName as (typeof humanApprovalNodes)[number])) {
      return {
        status: "paused" as const,
        currentNode: nodeName,
        pausedAt: nodeName,
        steps: [
          {
            nodeName,
            order: nodeOrder(nodeName),
            status: "waiting" as const,
            output: { waitingForHuman: true }
          }
        ]
      };
    }

    return {
      currentNode: nodeName,
      steps: [
        {
          nodeName,
          order: nodeOrder(nodeName),
          status: "completed" as const,
          output: { empty: true }
        }
      ]
    };
  };
}

function mergeWorkflowSteps(current: WorkflowStep[], updates: WorkflowStep[]) {
  const byNode = new Map(current.map((step) => [step.nodeName, step]));
  for (const update of updates) {
    byNode.set(update.nodeName, {
      ...byNode.get(update.nodeName),
      ...update
    });
  }

  return leadHuntWorkflowNodes.map((nodeName) => byNode.get(nodeName) ?? {
    nodeName,
    order: nodeOrder(nodeName),
    status: "pending" as const
  });
}

function nodeOrder(nodeName: LeadHuntWorkflowNode) {
  return leadHuntWorkflowNodes.indexOf(nodeName) + 1;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
