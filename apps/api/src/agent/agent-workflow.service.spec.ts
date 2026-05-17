import { describe, expect, it, vi } from "vitest";
import { AgentWorkflowService } from "./agent-workflow.service.js";

function createPrismaMock() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([
      {
        id: "task-1",
        status: "running",
        created_at: new Date("2026-05-03T08:00:00.000Z"),
        updated_at: new Date("2026-05-03T08:01:00.000Z"),
        prompt: "Find UAE telecom distributors and stockists",
        lead_count: 12,
        query_count: 15
      }
    ]),
    productProfile: {
      findUnique: vi.fn().mockResolvedValue({
        websiteUrl: "https://telecorenet.com/",
        productPageUrl: "https://telecorenet.com/products",
        documentUrls: ["https://telecorenet.com/catalog.pdf"],
        notes: "RRU BBU telecom spare parts"
      })
    },
    customerProfile: {
      findUnique: vi.fn().mockResolvedValue({
        targetRegions: ["UAE", "Saudi Arabia"],
        referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"],
        crmSampleIds: ["crm-1"],
        notes: "telecom distributors, stockists, system integrators"
      })
    },
    leadTask: {
      create: vi.fn().mockResolvedValue({ id: "task-1", status: "running" }),
      findMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({
        inputPayload: {
          prompt: "Find UAE telecom maintenance customers",
          keywordGroups: {
            productTerms: ["telecom equipment", "RRU", "BBU"],
            longTailProductTerms: ["Huawei RRU spare parts"],
            customerIntentTerms: ["telecom maintenance contractor", "ISP network operations"],
            marketTerms: ["UAE", "Saudi Arabia"],
            scenarioTerms: ["base station maintenance", "tower maintenance"],
            excludeTerms: ["jobs", "careers", "news"]
          },
          customerProfile: { targetRegions: ["UAE", "Saudi Arabia"] }
        },
        searchQueries: []
      }),
      findFirst: vi.fn().mockResolvedValue({
        id: "task-1",
        userId: "user-1",
        inputPayload: {
          customerProfile: { targetRegions: ["UAE"] },
          keywordGroups: {
            productTerms: ["telecom equipment", "RRU", "BBU"],
            longTailProductTerms: ["Huawei RRU spare parts"],
            customerIntentTerms: ["distributor", "stockist"],
            marketTerms: ["UAE"]
          }
        },
        searchQueries: [
          {
            id: "query-1",
            query: "telecom equipment distributor UAE",
            country: "UAE",
            createdAt: new Date("2026-04-30T01:00:00.000Z")
          }
        ],
        leadCandidates: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            companyName: "Gulf Telecom",
            website: "https://gulf.example",
            country: "UAE",
            countryConfidence: "high",
            countryConflict: false,
            status: "review",
            createdAt: new Date("2026-04-30T01:00:00.000Z"),
            contacts: [{ type: "email", value: "sales@gulf.example" }],
            icpScore: { score: 87, grade: "A" },
            outreachDrafts: [
              {
                id: "draft-1",
                status: "draft",
                sendLogs: []
              }
            ],
            crmLead: null,
            followupTasks: []
          }
        ]
      }),
      update: vi.fn().mockResolvedValue({ id: "task-1", status: "completed" })
    },
    leadCandidate: {
      findMany: vi.fn().mockResolvedValue([
        {
          companyName: "Spectrum MEA",
          website: "https://spectrummea.com/",
          country: "UAE",
          sourceUrl: "https://spectrummea.com/",
          contacts: [{ value: "sales@spectrummea.com" }]
        }
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    outreachDraft: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    searchQuery: {
      createMany: vi.fn().mockResolvedValue({ count: 15 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([{ executionStatus: "completed", resultCount: 1 }]),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0)
    },
    agentStep: {
      createMany: vi.fn().mockResolvedValue({ count: 16 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    }
  };
}

function createBraveSearchMock() {
  return {
    searchAndSaveResults: vi.fn().mockResolvedValue({
      count: 1,
      results: [
        {
          title: "Gulf Telecom Distributor",
          url: "https://gulf.example",
          snippet: "UAE telecom equipment distributor sales@gulf.example",
          source: "web"
        }
      ]
    }),
    saveResults: vi.fn().mockImplementation(async (_queryId: string, results: unknown[]) => ({
      count: results.length,
      results
    }))
  };
}

function createLeadQualificationMock() {
  return {
    saveCandidates: vi.fn().mockResolvedValue({
      createdCount: 1,
      skippedCount: 0,
      candidates: []
    })
  };
}

function createWebsiteContentMock() {
  return {
    readProfileSites: vi.fn().mockResolvedValue({
      productSites: [
        {
          url: "https://telecorenet.com/products",
          finalUrl: "https://telecorenet.com/products",
          domain: "telecorenet.com",
          role: "product",
          status: "read",
          title: "Telecore products",
          wordCount: 120,
          textSample: "Ericsson AIR radio units, Huawei WBBP, ZTE R8882 RRU and Eltek rectifier modules.",
          evidenceSnippets: ["Ericsson AIR radio units, Huawei WBBP, ZTE R8882 RRU and Eltek rectifier modules."],
          extractedTerms: {
            productTerms: ["Ericsson AIR", "Huawei WBBP", "ZTE R8882", "Eltek rectifier"],
            customerIntentTerms: [],
            scenarioTerms: ["5G network rollout"],
            brandTerms: ["Ericsson", "Huawei", "ZTE", "Eltek"]
          },
          fetchedAt: "2026-05-03T08:00:00.000Z"
        }
      ],
      referenceCustomerSites: [
        {
          url: "https://spectrummea.com/",
          finalUrl: "https://spectrummea.com/",
          domain: "spectrummea.com",
          role: "reference_customer",
          status: "read",
          title: "Spectrum MEA",
          wordCount: 90,
          textSample: "Telecom system integrator for microwave backhaul and managed services.",
          evidenceSnippets: ["Telecom system integrator for microwave backhaul and managed services."],
          extractedTerms: {
            productTerms: ["microwave backhaul"],
            customerIntentTerms: ["telecom system integrator", "managed service provider"],
            scenarioTerms: ["microwave backhaul project", "managed network service"],
            brandTerms: []
          },
          fetchedAt: "2026-05-03T08:00:00.000Z"
        },
        {
          url: "http://highcloud.ae/",
          finalUrl: "http://highcloud.ae/",
          domain: "highcloud.ae",
          role: "reference_customer",
          status: "failed",
          wordCount: 0,
          textSample: "",
          evidenceSnippets: [],
          extractedTerms: {
            productTerms: [],
            customerIntentTerms: [],
            scenarioTerms: [],
            brandTerms: []
          },
          error: "HTTP 403",
          fetchedAt: "2026-05-03T08:00:00.000Z"
        }
      ],
      summary: { attempted: 3, read: 2, failed: 1 }
    })
  };
}

function createLeadHuntAiMock(
  generateSearchStrategy: (input: {
    targetMarkets: string[];
  }) => Promise<{
    queries: Array<{
      query: string;
      country: string;
      language: string;
      operatorSource: string;
      executionStatus: string;
      rationale: string;
      priority: number;
    }>;
  }>
) {
  return {
    analyzeProductProfile: vi.fn().mockResolvedValue({
      brandName: "TeleCoreNet",
      websiteUrl: "https://telecorenet.com/",
      productCategories: ["Telecom equipment"],
      keyProducts: ["RRU", "BBU", "telecom power"],
      targetUseCases: ["5G network maintenance"],
      buyerPainPoints: ["Maintenance teams need spare parts"],
      supplyCapabilities: ["Telecom spare parts"],
      searchKeywords: ["RRU spare parts", "telecom power modules"],
      negativeKeywords: ["jobs", "training"],
      confidence: 0.82,
      evidence: ["Mock product evidence"]
    }),
    analyzeCustomerProfile: vi.fn().mockResolvedValue({
      targetRegions: ["UAE", "Saudi Arabia"],
      idealCustomerTypes: ["telecom maintenance contractor", "ISP operations"],
      buyingSignals: ["base station maintenance", "FTTH operations"],
      referenceCompanies: ["Spectrum MEA"],
      industries: ["telecommunications"],
      searchKeywords: ["telecom maintenance contractor"],
      disqualifiers: ["training center"],
      confidence: 0.8,
      evidence: ["Mock customer evidence"]
    }),
    expandKeywords: vi.fn().mockResolvedValue({
      primaryProducts: ["telecom equipment"],
      relatedProducts: ["RRU", "BBU", "rectifier module"],
      longTailProducts: ["Huawei RRU spare parts", "Eltek rectifier module"],
      upstreamDownstreamTerms: ["base station maintenance", "tower maintenance", "FTTH operations"],
      purchaseIntentTerms: ["telecom maintenance contractor", "ISP network operations", "tower maintenance company"],
      targetMarketTerms: ["UAE", "Saudi Arabia"],
      industryScenarioTerms: ["5G network maintenance", "cell site power maintenance"],
      exclusionTerms: ["jobs", "careers", "news"]
    }),
    generateSearchStrategy: vi.fn(generateSearchStrategy)
  };
}

function aiSearchQuery(query: string, country: string, priority: number) {
  return {
    query,
    country,
    language: "en",
    operatorSource: "brave_official",
    executionStatus: "supported",
    rationale: "Targets telecom infrastructure buyers",
    priority
  };
}

function simpleAiQueriesForMarkets(markets: string[]) {
  return Array.from({ length: 15 }, (_, index) => {
    const country = markets[index % markets.length] ?? "Canada";
    const buyerTerm = index % 3 === 0 ? "base station maintenance" : index % 3 === 1 ? "ISP network operations" : "tower maintenance";
    return aiSearchQuery(`"${buyerTerm}" ${country} telecom -jobs -news`, country, index + 1);
  });
}

describe("AgentWorkflowService", () => {
  it("rejects unknown LangGraph checkpoint stores", () => {
    const originalStore = process.env.LANGGRAPH_CHECKPOINT_STORE;
    process.env.LANGGRAPH_CHECKPOINT_STORE = "redis";

    try {
      expect(() => new AgentWorkflowService(createPrismaMock() as any)).toThrow(
        "LANGGRAPH_CHECKPOINT_STORE must be one of: memory, postgres"
      );
    } finally {
      if (originalStore === undefined) {
        delete process.env.LANGGRAPH_CHECKPOINT_STORE;
      } else {
        process.env.LANGGRAPH_CHECKPOINT_STORE = originalStore;
      }
    }
  });

  it("lists task history with candidate and query counts", async () => {
    const prisma = createPrismaMock();
    const service = new AgentWorkflowService(prisma as any);

    const result = await service.listTasksForUser("user-1", { limit: 30 });

    expect(result).toEqual({
      tasks: [
        {
          id: "task-1",
          status: "running",
          createdAt: new Date("2026-05-03T08:00:00.000Z"),
          updatedAt: new Date("2026-05-03T08:01:00.000Z"),
          prompt: "Find UAE telecom distributors and stockists",
          title: "Find UAE telecom distributors and st",
          leadCount: 12,
          queryCount: 15
        }
      ]
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.leadTask.findMany).not.toHaveBeenCalled();
  });

  it("creates a task and writes the full agent_steps timeline", async () => {
    const prisma = createPrismaMock();
    const service = new AgentWorkflowService(prisma as any);

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find UAE telecom distributors",
      targetCount: 20
    });

    expect(result.steps).toHaveLength(16);
    expect(result.searchQueries).toHaveLength(30);
    expect(new Set(result.searchQueries.map((query) => query.country))).not.toContain("Nigeria");
    expect(prisma.productProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(prisma.customerProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(prisma.leadTask.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        status: "running",
        targetCount: 20,
        inputPayload: expect.objectContaining({
          prompt: "Find UAE telecom distributors",
          targetCount: 20,
          productProfile: expect.objectContaining({
            websiteUrl: "https://telecorenet.com/"
          }),
          customerProfile: expect.objectContaining({
            targetRegions: ["UAE", "Saudi Arabia"]
          }),
          executionPlan: expect.arrayContaining([
            expect.objectContaining({ step: "load_task" }),
            expect.objectContaining({ step: "plan_search_queries" })
          ]),
          searchQueries: expect.any(Array)
        })
      }
    });
    expect(prisma.agentStep.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ taskId: "task-1", nodeName: "load_task", status: "pending" }),
        expect.objectContaining({ taskId: "task-1", nodeName: "task_summary", status: "pending" })
      ])
    });
    expect(prisma.searchQuery.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          provider: "brave",
          executionStatus: "pending",
          query: expect.any(String)
        })
      ])
    });
  });

  it("keeps manually selected target countries in the generated search queries", async () => {
    const prisma = createPrismaMock();
    prisma.customerProfile.findUnique.mockResolvedValue({
      targetRegions: ["Germany", "Poland", "Oman"],
      referenceCustomerUrls: [],
      crmSampleIds: [],
      notes: "telecom distributors"
    });
    const service = new AgentWorkflowService(prisma as any);

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find telecom equipment buyers in Germany, Poland, and Oman",
      targetCount: 20
    });

    expect(result.searchQueries).toHaveLength(30);
    expect(new Set(result.searchQueries.map((query) => query.country))).toEqual(new Set(["Germany", "Poland", "Oman"]));
    expect(result.searchQueries.map((query) => query.country)).not.toContain("Global");
  });

  it("expands macro profile regions into concrete countries before AI query planning", async () => {
    const prisma = createPrismaMock();
    prisma.customerProfile.findUnique.mockResolvedValue({
      targetRegions: ["Middle East", "Africa", "Brazil", "Russia", "Ukraine"],
      referenceCustomerUrls: [],
      crmSampleIds: [],
      notes: "Use saved target markets."
    });
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    const service = new AgentWorkflowService(prisma as any, undefined, undefined, undefined, ai as any);

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment customers",
      targetCount: 20
    });
    const queryCountries = result.searchQueries.map((query) => query.country);

    expect(ai.generateSearchStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetMarkets: expect.arrayContaining([
          "UAE",
          "Saudi Arabia",
          "Qatar",
          "Oman",
          "Kuwait",
          "Bahrain",
          "Jordan",
          "Iraq",
          "Iran",
          "Nigeria",
          "Kenya",
          "South Africa",
          "Egypt",
          "Morocco",
          "Ghana",
          "Tanzania",
          "Brazil",
          "Russia",
          "Ukraine"
        ])
      })
    );
    expect(queryCountries).not.toContain("Middle East");
    expect(queryCountries).not.toContain("Africa");
    expect(result.searchQueries).toHaveLength(30);
  });

  it("lets explicit prompt markets override saved profile target regions for AI planning", async () => {
    const prisma = createPrismaMock();
    prisma.customerProfile.findUnique.mockResolvedValue({
      targetRegions: ["Middle East", "UAE", "Iran", "Russia", "Saudi Arabia"],
      referenceCustomerUrls: ["https://spectrummea.com/"],
      crmSampleIds: [],
      notes: "Legacy profile regions should not override this task."
    });
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    const service = new AgentWorkflowService(prisma as any, undefined, undefined, undefined, ai as any);

    const result = await service.createTaskWithTimeline("user-1", {
      prompt:
        "Acceptance test: find Canada and Australia 5G telecom equipment buyers, prioritizing base station maintenance, tower maintenance, telecom power maintenance, operators, ISP and FTTH network operations customers.",
      targetCount: 20
    });

    const queryCountries = result.searchQueries.map((query) => query.country);
    expect(new Set(queryCountries)).toEqual(new Set(["Canada", "Australia"]));
    expect(queryCountries).not.toContain("UAE");
    expect(queryCountries).not.toContain("Saudi Arabia");
    expect(queryCountries).not.toContain("Iran");
    expect(queryCountries).not.toContain("Russia");
    expect(ai.generateSearchStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetMarkets: ["Canada", "Australia"]
      })
    );
    expect(prisma.leadTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputPayload: expect.objectContaining({
          keywordGroups: expect.objectContaining({
            marketTerms: ["Canada", "Australia"]
          }),
          profileSignals: expect.objectContaining({
            marketSelection: expect.objectContaining({
              targetMarkets: ["Canada", "Australia"],
              promptMarkets: ["Canada", "Australia"],
              profileMarkets: expect.arrayContaining(["UAE", "Iran", "Russia", "Saudi Arabia"]),
              marketSource: "prompt"
            })
          })
        })
      })
    });
  });

  it("sanitizes or rejects mixed-country GPT search queries before persisting them", async () => {
    const prisma = createPrismaMock();
    prisma.customerProfile.findUnique.mockResolvedValue({
      targetRegions: ["UAE", "Iran", "Russia", "Saudi Arabia"],
      referenceCustomerUrls: [],
      crmSampleIds: [],
      notes: "Legacy profile regions should be ignored when prompt names markets."
    });
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: [
        aiSearchQuery(
          'site:.ru (Huawei OR ZTE OR Ericsson OR Nokia) ("RRU" OR "BBU" OR "AAU") Russia "UAE" -jobs -careers',
          "UAE",
          1
        ),
        aiSearchQuery(
          '("base station maintenance" OR "RAN maintenance" OR "cell site maintenance") Canada "Australia telecom tower maintenance" -jobs -careers -training -news',
          "Australia telecom tower maintenance",
          2
        ),
        aiSearchQuery(
          '("telecom contractor" OR "network maintenance") Ukraine "Iran" -jobs -careers',
          "Iran",
          3
        ),
        aiSearchQuery('("Huawei MA5800" OR "Huawei MA5608T") Canada OLT supplier price datasheet -jobs -news', "Canada", 4),
        ...simpleAiQueriesForMarkets(input.targetMarkets).map((query, index) => ({
          ...query,
          priority: index + 5
        }))
      ]
    }));
    const service = new AgentWorkflowService(prisma as any, undefined, undefined, undefined, ai as any);

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find Canada and Australia 5G telecom maintenance buyers",
      targetCount: 20
    });
    const queryText = result.searchQueries.map((query) => query.query).join("\n");
    const persistedPayload = prisma.leadTask.create.mock.calls[0]?.[0].data.inputPayload;

    expect(result.searchQueries).toHaveLength(30);
    expect(new Set(result.searchQueries.map((query) => query.country))).toEqual(new Set(["Canada", "Australia"]));
    expect(queryText).not.toMatch(/\bRussia\b/i);
    expect(queryText).not.toMatch(/\bUAE\b/i);
    expect(queryText).not.toMatch(/\bUkraine\b/i);
    expect(queryText).not.toMatch(/\bIran\b/i);
    expect(queryText).not.toContain("site:.ru");
    expect(queryText).not.toContain('"Australia telecom tower maintenance"');
    expect(queryText).not.toContain("supplier price datasheet");
    expect(persistedPayload.profileSignals.aiPlanning.rejectedQueryCount).toBeGreaterThan(0);
    expect(persistedPayload.profileSignals.aiPlanning.rejectedQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringMatching(/off_target_market|market_conflict/)
        })
      ])
    );
  });

  it("reads profile websites and stores evidence-based analysis in the task payload", async () => {
    const prisma = createPrismaMock();
    const websiteContent = createWebsiteContentMock();
    const service = new AgentWorkflowService(prisma as any, undefined, undefined, websiteContent as any);

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment related buyer customers",
      targetCount: 20
    });

    expect(websiteContent.readProfileSites).toHaveBeenCalledWith({
      productUrls: ["https://telecorenet.com/", "https://telecorenet.com/products", "https://telecorenet.com/catalog.pdf"],
      referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"]
    });
    expect(result.searchQueries[0]?.keywordGroups.productTerms).toEqual(expect.arrayContaining(["Ericsson AIR", "Huawei WBBP"]));
    expect(result.searchQueries[0]?.keywordGroups.customerIntentTerms).toEqual(
      expect.arrayContaining(["telecom system integrator", "managed service provider"])
    );
    expect(prisma.leadTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputPayload: expect.objectContaining({
          siteEvidence: expect.objectContaining({
            summary: { attempted: 3, read: 2, failed: 1 }
          }),
          productProfileAnalysis: expect.objectContaining({
            source: "website_content",
            keyProducts: expect.arrayContaining(["Ericsson AIR", "Huawei WBBP"])
          }),
          customerProfileAnalysis: expect.objectContaining({
            source: "website_content",
            idealCustomerTypes: expect.arrayContaining(["telecom system integrator"])
          }),
          profileSignals: expect.objectContaining({
            productUrlsRead: ["https://telecorenet.com/products"],
            failedUrlCount: 1
          })
        })
      })
    });
  });

  it("falls back to task text and default keyword groups when profiles are missing", async () => {
    const prisma = createPrismaMock();
    prisma.productProfile.findUnique.mockResolvedValue(null);
    prisma.customerProfile.findUnique.mockResolvedValue(null);
    const service = new AgentWorkflowService(prisma as any);

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find Qatar microwave backhaul integrators"
    });

    expect(result.searchQueries).toHaveLength(30);
    expect(prisma.leadTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputPayload: expect.objectContaining({
          productProfile: null,
          customerProfile: null,
          executionPlan: expect.arrayContaining([
            expect.objectContaining({
              step: "analyze_product_profile",
              detail: expect.any(String)
            })
          ])
        })
      })
    });
  });

  it("records failed node state and retry state", async () => {
    const prisma = createPrismaMock();
    const service = new AgentWorkflowService(prisma as any);

    await service.markStepFailed("task-1", "brave_search", "timeout");
    await service.retryStep("task-1", "brave_search");

    expect(prisma.agentStep.updateMany).toHaveBeenNthCalledWith(1, {
      where: { taskId: "task-1", nodeName: "brave_search" },
      data: expect.objectContaining({
        status: "failed",
        error: "timeout"
      })
    });
    expect(prisma.agentStep.updateMany).toHaveBeenNthCalledWith(2, {
      where: { taskId: "task-1", nodeName: "brave_search" },
      data: expect.objectContaining({
        status: "running",
        output: { retry: true },
        error: null
      })
    });
  });

  it("pauses and resumes at a human confirmation node", async () => {
    const prisma = createPrismaMock();
    const service = new AgentWorkflowService(prisma as any);

    await service.pauseAtHumanApproval("task-1", "wait_email_confirmation");
    await service.markStepCompleted("task-1", "wait_email_confirmation", { approved: true });

    expect(prisma.agentStep.updateMany).toHaveBeenNthCalledWith(1, {
      where: { taskId: "task-1", nodeName: "wait_email_confirmation" },
      data: expect.objectContaining({
        status: "waiting",
        output: { waitingForHuman: true }
      })
    });
    expect(prisma.agentStep.updateMany).toHaveBeenNthCalledWith(2, {
      where: { taskId: "task-1", nodeName: "wait_email_confirmation" },
      data: expect.objectContaining({
        status: "completed",
        output: { approved: true },
        error: null
      })
    });
  });

  it("approves selected candidates, creates outreach drafts, and waits for email confirmation", async () => {
    const prisma = createPrismaMock();
    const service = new AgentWorkflowService(prisma as any);

    const result = await service.approveCandidatesForUser("user-1", "task-1", {
      leadIds: ["11111111-1111-4111-8111-111111111111"]
    });

    expect(result).toEqual({
      ok: true,
      approvedLeadIds: ["11111111-1111-4111-8111-111111111111"],
      approvedCount: 1,
      draftCount: 1
    });
    expect(prisma.leadCandidate.updateMany).toHaveBeenCalledWith({
      where: {
        taskId: "task-1",
        id: { in: ["11111111-1111-4111-8111-111111111111"] }
      },
      data: { status: "approved" }
    });
    expect(prisma.outreachDraft.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId: "11111111-1111-4111-8111-111111111111",
          channel: "email",
          subject: "Supply support for Gulf Telecom",
          status: "draft"
        })
      ]
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "human_approval" },
      data: expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          approved: true,
          approvedCount: 1
        })
      })
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "generate_email" },
      data: expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          draftCount: 1
        })
      })
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "wait_email_confirmation" },
      data: expect.objectContaining({
        status: "waiting",
        output: { waitingForHuman: true }
      })
    });
  });

  it("resumes the LangGraph search thread from lead approval to email confirmation", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });
    const result = await service.approveCandidatesForUser("user-1", "task-1", {
      leadIds: ["11111111-1111-4111-8111-111111111111"]
    });

    expect(result).toEqual({
      ok: true,
      approvedLeadIds: ["11111111-1111-4111-8111-111111111111"],
      approvedCount: 1,
      draftCount: 1
    });
    expect(prisma.leadCandidate.updateMany).toHaveBeenCalledWith({
      where: {
        taskId: "task-1",
        id: { in: ["11111111-1111-4111-8111-111111111111"] }
      },
      data: { status: "approved" }
    });
    expect(prisma.outreachDraft.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId: "11111111-1111-4111-8111-111111111111",
          status: "draft"
        })
      ]
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "wait_email_confirmation" },
      data: expect.objectContaining({
        status: "waiting",
        output: { waitingForHuman: true }
      })
    });
  });

  it("executes pending Brave searches, saves candidates, and completes search steps", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    const result = await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(result).toEqual({
      ok: true,
      executedQueries: 1,
      successfulQueries: 1,
      failedQueries: 0,
      resultCount: 1,
      createdCandidates: 1,
      skippedCandidates: 0,
      fallback: false,
      errors: [],
      hasMore: false,
      remainingQueries: 0
    });
    expect(braveSearch.searchAndSaveResults).toHaveBeenCalledWith("query-1", {
      query: "telecom equipment distributor UAE",
      country: "ALL",
      language: "en",
      count: 20
    });
    expect(leadQualification.saveCandidates).toHaveBeenCalledWith(
      "task-1",
      expect.any(Array),
      expect.objectContaining({
        targetRegions: ["UAE"],
        productKeywords: expect.arrayContaining(["telecom equipment", "RRU"]),
        customerTypeKeywords: expect.arrayContaining(["distributor"])
      }),
      "UAE"
    );
    expect(prisma.searchQuery.update).toHaveBeenCalledWith({
      where: { id: "query-1" },
      data: {
          executionStatus: "completed",
          resultCount: 1,
          qualifiedCount: 1
        }
      });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "brave_search" },
      data: expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          executedQueries: 1,
          resultCount: 1,
          fallback: false
        })
      })
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "score_icp" },
      data: expect.objectContaining({
        status: "completed",
        output: { createdCandidates: 1 }
      })
    });
  });

  it("marks failed Brave searches without breaking the whole task endpoint", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    braveSearch.searchAndSaveResults
      .mockRejectedValueOnce(new Error("Brave HTTPS request timed out"))
      .mockRejectedValueOnce(new Error("Brave HTTPS request timed out"));
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    const result = await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(result).toEqual({
      ok: false,
      executedQueries: 1,
      successfulQueries: 0,
      failedQueries: 1,
      resultCount: 0,
      createdCandidates: 0,
      skippedCandidates: 0,
      fallback: false,
      errors: [{ queryId: "query-1", message: "Brave HTTPS request timed out" }],
      hasMore: false,
      remainingQueries: 0
    });
    expect(leadQualification.saveCandidates).not.toHaveBeenCalled();
    expect(prisma.searchQuery.update).toHaveBeenCalledWith({
      where: { id: "query-1" },
      data: {
        executionStatus: "failed",
        resultCount: 0,
        qualifiedCount: 0
      }
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "brave_search" },
      data: expect.objectContaining({
        status: "failed",
        error: "Brave HTTPS request timed out"
      })
    });
  });

  it("retries a failed Brave query with a neutral country parameter before marking it failed", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    braveSearch.searchAndSaveResults.mockRejectedValueOnce(new Error("Brave country parameter failed"));
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    const result = await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(result).toMatchObject({
      ok: true,
      executedQueries: 1,
      successfulQueries: 1,
      failedQueries: 0,
      resultCount: 1,
      createdCandidates: 1,
      fallback: false
    });
    expect(braveSearch.searchAndSaveResults).toHaveBeenNthCalledWith(
      2,
      "query-1",
      expect.objectContaining({
        country: "US"
      })
    );
  });

  it("runs all pending searches when no explicit limit is provided", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    await service.executeBraveSearchForTask("user-1", "task-1");

    expect(prisma.leadTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          searchQueries: expect.not.objectContaining({
            take: expect.any(Number)
          })
        }
      })
    );
  });

  it("requests and processes up to 20 Brave results per query", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    braveSearch.searchAndSaveResults.mockResolvedValueOnce({
      count: 25,
      results: Array.from({ length: 25 }, (_, index) => ({
        title: `Telecom Distributor ${index + 1}`,
        url: `https://example-${index + 1}.ae/contact`,
        snippet: "UAE telecom equipment distributor with RRU and BBU stock. sales@example.ae",
        source: "web" as const
      }))
    });
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(braveSearch.searchAndSaveResults).toHaveBeenCalledWith(
      "query-1",
      expect.objectContaining({
        count: 20
      })
    );
    expect(leadQualification.saveCandidates.mock.calls[0]?.[1]).toHaveLength(20);
  });

  it("rewrites pending queries with local buyer fallback when the first-stage quality gate trips", async () => {
    const prisma = createPrismaMock();
    prisma.leadTask.findUnique.mockResolvedValueOnce({
      inputPayload: {
        prompt: "Find telecom equipment buyers",
        keywordGroups: {
          productTerms: ["RRU", "BBU", "rectifier"],
          longTailProductTerms: ["Huawei R4850N6"],
          customerIntentTerms: ["telecom maintenance contractor", "ISP network operations"],
          marketTerms: ["Kenya", "Morocco"],
          scenarioTerms: ["base station maintenance", "FTTH operations"],
          excludeTerms: ["jobs", "careers", "news"]
        },
        customerProfile: { targetRegions: ["Kenya", "Morocco"] }
      },
      searchQueries: [
        {
          query: '"base station maintenance" Kenya contact -jobs -news',
          provider: "brave",
          operatorSource: "brave_official",
          executionStatus: "completed",
          operatorName: "GPT",
          strategyTemplate: "buyer",
          keywordGroups: null,
          country: "Kenya",
          effectivenessScore: 0.8
        },
        {
          query: '"telecom equipment supplier" Morocco contact',
          provider: "brave",
          operatorSource: "brave_official",
          executionStatus: "pending",
          operatorName: "GPT",
          strategyTemplate: "supplier",
          keywordGroups: null,
          country: "Morocco",
          effectivenessScore: 0.5
        },
        {
          query: '"5G equipment stockist" Kenya contact',
          provider: "brave",
          operatorSource: "brave_official",
          executionStatus: "pending",
          operatorName: "GPT",
          strategyTemplate: "stockist",
          keywordGroups: null,
          country: "Kenya",
          effectivenessScore: 0.5
        }
      ]
    });
    prisma.searchQuery.count.mockResolvedValueOnce(2);
    const service = new AgentWorkflowService(prisma as any);

    const result = await (service as any).rewritePendingQueriesForQualityGate("task-1", {
      reasons: ["country_issue_ratio_high"],
      executedQueryCount: 15
    });

    expect(result).toMatchObject({
      rewrittenCount: 2,
      removedPendingCount: 2,
      remainingQueries: 2,
      reasons: ["country_issue_ratio_high"]
    });
    expect(prisma.searchQuery.deleteMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", executionStatus: "pending" }
    });
    expect(prisma.searchQuery.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          executionStatus: "pending",
          operatorName: "Quality fallback local buyer search",
          query: expect.stringMatching(/\b(Kenya|Morocco)\b/)
        })
      ])
    });
    const createdQueries = prisma.searchQuery.createMany.mock.calls[0]?.[0].data.map((query: { query: string }) => query.query);
    expect(createdQueries).toHaveLength(2);
    expect(createdQueries.join("\n")).not.toMatch(/\bsupplier\b|\bstockist\b/i);
    expect(prisma.leadTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({
        inputPayload: expect.objectContaining({
          profileSignals: expect.objectContaining({
            qualityFallback: expect.objectContaining({
              action: "rewrote_pending_queries_with_local_buyer_fallback",
              replacementQueryCount: 2,
              removedPendingQueryCount: 2
            })
          })
        })
      })
    });
  });

  it("marks candidate cleanup errors per query instead of throwing a 500", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    leadQualification.saveCandidates.mockRejectedValueOnce(new Error("candidate enrichment failed"));
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    const result = await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(result).toMatchObject({
      ok: false,
      executedQueries: 1,
      successfulQueries: 0,
      failedQueries: 1,
      errors: [{ queryId: "query-1", message: "candidate enrichment failed" }]
    });
    expect(prisma.searchQuery.update).toHaveBeenCalledWith({
      where: { id: "query-1" },
      data: {
        executionStatus: "failed",
        resultCount: 0,
        qualifiedCount: 0
      }
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "brave_search" },
      data: expect.objectContaining({
        status: "failed",
        error: "candidate enrichment failed"
      })
    });
  });

  it("uses development search fallback only when the explicit flag is enabled", async () => {
    const originalFlag = process.env.LEADHUNT_DEV_SEARCH_FALLBACK;
    process.env.LEADHUNT_DEV_SEARCH_FALLBACK = "true";
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    braveSearch.searchAndSaveResults
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockRejectedValueOnce(new Error("network timeout"));
    const service = new AgentWorkflowService(prisma as any, braveSearch as any, leadQualification as any);

    try {
      const result = await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

      expect(result).toMatchObject({
        ok: true,
        executedQueries: 1,
        resultCount: 4,
        createdCandidates: 1,
        skippedCandidates: 0,
        fallback: true
      });
      expect(braveSearch.saveResults).toHaveBeenCalledWith(
        "query-1",
        expect.arrayContaining([
          expect.objectContaining({
            title: expect.stringContaining("Telecom")
          })
        ])
      );
      expect(leadQualification.saveCandidates).toHaveBeenCalledWith(
        "task-1",
        expect.arrayContaining([
          expect.objectContaining({
            url: expect.stringContaining(".example")
          })
        ]),
        expect.any(Object),
        "UAE"
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.LEADHUNT_DEV_SEARCH_FALLBACK;
      } else {
        process.env.LEADHUNT_DEV_SEARCH_FALLBACK = originalFlag;
      }
    }
  });

  it("writes a clear task summary and completes the task", async () => {
    const prisma = createPrismaMock();
    const service = new AgentWorkflowService(prisma as any);

    const result = await service.summarizeTaskForUser("user-1", "task-1");

    expect(result.ok).toBe(true);
    expect(result.summary.did).toHaveLength(4);
    expect(result.summary.found).toMatchObject({
      totalCandidates: 1,
      qualifiedCandidates: 1,
      topCompanies: ["Gulf Telecom"]
    });
    expect(result.summary.sent).toMatchObject({
      draftCount: 1,
      sentCount: 0,
      crmSynced: 0
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "task_summary" },
      data: expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          did: expect.any(Array),
          found: expect.any(Object),
          sent: expect.any(Object),
          next: expect.any(Array)
        })
      })
    });
    expect(prisma.leadTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { status: "completed" }
    });
  });
});
