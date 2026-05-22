import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentWorkflowService, splitReferenceCompanyAliases, resolveSearchQueryConcurrency } from "./agent-workflow.service.js";

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
        query_count: 15,
        pending_crm_count: 7,
        pending_email_count: 3
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
      // 2026-05 V1-MVP Step 4: brave_search runner is now a polling
      // loop that calls findFirst pending → updateMany claim → process.
      // Default: return one pending query, then null on subsequent calls.
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({
          id: "query-1",
          query: "telecom equipment distributor UAE",
          country: "UAE",
          createdAt: new Date("2026-04-30T01:00:00.000Z")
        })
        .mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      // updateMany: claim path (where.executionStatus === "pending")
      // returns count=1 by default. Cleanup path
      // (where.executionStatus === "running", used by the worker pool
      // to reset stale running queries) returns count=0 — no leftover
      // running queries in the default test fixture.
      updateMany: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.executionStatus === "running") {
          return { count: 0 };
        }
        return { count: 1 };
      }),
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
      candidates: [{ id: "cand-1", status: "qualified" }]
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
          textSample:
            "Ericsson AIR radio units, Huawei WBBP, ZTE R8882 RRU and Eltek rectifier modules.",
          evidenceSnippets: [
            "Ericsson AIR radio units, Huawei WBBP, ZTE R8882 RRU and Eltek rectifier modules."
          ],
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
          evidenceSnippets: [
            "Telecom system integrator for microwave backhaul and managed services."
          ],
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
    targetMarketProfiles?: Array<{
      country: string;
      countryName: string;
      tier?: number;
      language?: string;
      anchors?: string[];
      phoneCode?: string | null;
      tlds?: string[];
    }>;
    refillContext?: {
      requiredAdditionalQueries: number;
      acceptedQueries: Array<{
        query: string;
        country?: string | null;
        strategyType?: string | null;
      }>;
      rejectedQueries: Array<{ query: string; country: string; reason: string }>;
    };
  }) => Promise<{
    queries: Array<{
      query?: string;
      coreQuery?: string;
      country: string;
      countryName?: string;
      language: string;
      operatorSource: string;
      executionStatus?: string;
      engineCompatibility?: string;
      rationale: string;
      strategyType?: string;
      intelligenceType?: string;
      expectedResultType?: string;
      confidence?: string;
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
      purchaseIntentTerms: [
        "telecom maintenance contractor",
        "ISP network operations",
        "tower maintenance company"
      ],
      targetMarketTerms: ["UAE", "Saudi Arabia"],
      industryScenarioTerms: ["5G network maintenance", "cell site power maintenance"],
      exclusionTerms: ["jobs", "careers", "news"]
    }),
    generateSearchStrategy: vi.fn(generateSearchStrategy)
  };
}

function aiSearchQuery(
  query: string,
  country: string,
  priority: number,
  strategyType = "buyer_scenario"
) {
  return {
    query,
    country,
    language: "en",
    operatorSource: "brave_official",
    executionStatus: "supported",
    rationale: "Targets telecom infrastructure buyers",
    strategyType,
    buyerIntent: "telecom maintenance buyer",
    productEvidence: ["telecom equipment"],
    customerEvidence: ["telecom maintenance contractor"],
    priority
  };
}

function simpleAiQueriesForMarkets(markets: string[]) {
  const strategyTypes = [
    ...Array.from({ length: 12 }, () => "buyer_scenario"),
    ...Array.from({ length: 9 }, () => "product_group"),
    ...Array.from({ length: 3 }, () => "brand_ecosystem"),
    ...Array.from({ length: 6 }, () => "model_specific")
  ];

  return Array.from({ length: 30 }, (_, index) => {
    const country = markets[index % markets.length] ?? "Canada";
    const roleTerms = [
      "base station maintenance",
      "RAN maintenance",
      "tower maintenance",
      "telecom power maintenance",
      "FTTH network operations",
      "DAS integrator",
      "microwave backhaul contractor",
      "private 5G integrator",
      "cell site maintenance",
      "operator procurement"
    ];
    const productTerms = [
      "RRU BBU",
      "base station equipment",
      "5G telecom equipment",
      "rectifier module",
      "OLT equipment",
      "SFP optical module",
      "AAU radio unit",
      "microwave backhaul",
      "telecom power module",
      "RAN equipment",
      "remote radio unit",
      "baseband unit",
      "Huawei R4850N6",
      "Ericsson AIR 6488",
      "Nokia FBBC board",
      "ZTE R8882 RRU",
      "Eltek rectifier",
      "Huawei OLT MA5800",
      "SFP transceiver",
      "telecom cable materials",
      "DAS small cell",
      "private 5G equipment",
      "microwave radio",
      "cell site power",
      "base station spare parts",
      "RAN spare parts",
      "BBU board",
      "AAU antenna",
      "telecom optical module",
      "network power system"
    ];
    const entry = index % 4 === 0 ? "contact" : index % 4 === 1 ? "services" : "projects";
    const phrase = `"${roleTerms[index % roleTerms.length]}" "${productTerms[index]}" "5G telecom equipment" ${country} ${entry}`;
    return aiSearchQuery(phrase, country, index + 1, strategyTypes[index] ?? "buyer_scenario");
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
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "task-1",
          status: "running",
          created_at: new Date("2026-05-03T08:00:00.000Z"),
          updated_at: new Date("2026-05-03T08:01:00.000Z"),
          prompt: "Find UAE telecom distributors and stockists",
          lead_count: 12,
          query_count: 15,
          pending_crm_count: 7,
          pending_email_count: 3
        }
      ])
      .mockResolvedValueOnce([
        {
          task_count: 41,
          today_lead_count: 12,
          pending_crm_count: 120,
          pending_email_count: 8
        }
      ]);
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
          queryCount: 15,
          pendingCrmCount: 7,
          pendingEmailCount: 3
        }
      ],
      summary: {
        taskCount: 41,
        todayLeadCount: 12,
        pendingCrmCount: 120,
        pendingEmailCount: 8
      }
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.leadTask.findMany).not.toHaveBeenCalled();
  });

  it("hides intelligence and evidence leads from customer-list task responses", async () => {
    const prisma = createPrismaMock();
    prisma.leadTask.findFirst.mockResolvedValueOnce({
      id: "task-1",
      userId: "user-1",
      mode: "semi_managed",
      status: "paused",
      targetCount: 20,
      inputPayload: null,
      createdAt: new Date("2026-05-03T08:00:00.000Z"),
      updatedAt: new Date("2026-05-03T08:05:00.000Z"),
      agentSteps: [],
      searchQueries: [],
      leadCandidates: [
        {
          id: "lead-1",
          taskId: "task-1",
          companyName: "Gulf Telecom",
          website: "https://gulf.example",
          country: "UAE",
          queryCountry: "UAE",
          inferredCountry: "UAE",
          countryEvidence: null,
          countryConfidence: "high",
          countryConflict: false,
          sourceUrl: "https://gulf.example",
          status: "review",
          createdAt: new Date("2026-05-03T08:00:00.000Z"),
          updatedAt: new Date("2026-05-03T08:00:00.000Z"),
          contacts: [],
          icpScore: { id: "score-1", score: 67, grade: "B", reasons: [], createdAt: new Date() },
          crmLead: null,
          followupTasks: [],
          outreachDrafts: []
        },
        {
          id: "lead-2",
          taskId: "task-1",
          companyName: "Market Report",
          website: "https://reports.example",
          country: null,
          queryCountry: "UAE",
          inferredCountry: null,
          countryEvidence: null,
          countryConfidence: "unknown",
          countryConflict: false,
          sourceUrl: "https://reports.example",
          status: "intelligence_review",
          createdAt: new Date("2026-05-03T08:00:00.000Z"),
          updatedAt: new Date("2026-05-03T08:00:00.000Z"),
          contacts: [],
          icpScore: { id: "score-2", score: 49, grade: "D", reasons: [], createdAt: new Date() },
          crmLead: null,
          followupTasks: [],
          outreachDrafts: []
        },
        {
          id: "lead-3",
          taskId: "task-1",
          companyName: "Blog Article",
          website: "https://blog.example",
          country: null,
          queryCountry: "UAE",
          inferredCountry: null,
          countryEvidence: null,
          countryConfidence: "unknown",
          countryConflict: false,
          sourceUrl: "https://blog.example",
          status: "evidence_review",
          createdAt: new Date("2026-05-03T08:00:00.000Z"),
          updatedAt: new Date("2026-05-03T08:00:00.000Z"),
          contacts: [],
          icpScore: { id: "score-3", score: 49, grade: "D", reasons: [], createdAt: new Date() },
          crmLead: null,
          followupTasks: [],
          outreachDrafts: []
        }
      ]
    });
    const service = new AgentWorkflowService(prisma as any);

    const result = (await service.getTaskForUser("user-1", "task-1")) as any;

    expect(result.leadCandidates.map((lead: { companyName: string }) => lead.companyName)).toEqual([
      "Gulf Telecom"
    ]);
    expect(prisma.leadTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          leadCandidates: expect.objectContaining({
            where: {
              status: {
                notIn: expect.arrayContaining([
                  // 2026-05 simplified statuses we hide.
                  "intelligence",
                  "rejected",
                  // Legacy statuses kept for back-compat with historical
                  // task rows.
                  "intelligence_review",
                  "evidence_review"
                ])
              }
            }
          })
        })
      })
    );
  });

  it("creates a task and writes the full agent_steps timeline", async () => {
    const prisma = createPrismaMock();
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find UAE telecom distributors",
      targetCount: 20
    });

    expect(result.steps).toHaveLength(16);
    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
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
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find telecom equipment buyers in Germany, Poland, and Oman",
      targetCount: 20
    });

    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
    expect(new Set(result.searchQueries.map((query) => query.country))).toEqual(
      new Set(["Germany", "Poland", "Oman"])
    );
    expect(result.searchQueries.map((query) => query.country)).not.toContain("Global");
  });

  it("detects Kuwait as an explicit prompt market for search planning", async () => {
    const prisma = createPrismaMock();
    prisma.customerProfile.findUnique.mockResolvedValue({
      targetRegions: ["UAE"],
      referenceCustomerUrls: [],
      crmSampleIds: [],
      notes: "Saved profile should not hide explicitly requested Kuwait."
    });
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find telecom equipment buyers in UAE and Kuwait",
      targetCount: 20
    });

    expect(ai.generateSearchStrategy.mock.calls[0]?.[0].targetMarkets).toEqual([
      "UAE",
      "Kuwait"
    ]);
    expect(new Set(result.searchQueries.map((query) => query.country))).toEqual(
      new Set(["UAE", "Kuwait"])
    );
  });

  it("keeps macro profile regions auditable while planning only the primary market pool first", async () => {
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
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment customers",
      targetCount: 20
    });
    const queryCountries = result.searchQueries.map((query) => query.country);

    const aiInput = ai.generateSearchStrategy.mock.calls[0]?.[0];
    expect(aiInput?.targetMarkets).toEqual(["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"]);
    expect(queryCountries).not.toContain("Middle East");
    expect(queryCountries).not.toContain("Africa");
    expect(new Set(queryCountries)).toEqual(
      new Set(["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"])
    );
    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
    expect(prisma.leadTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputPayload: expect.objectContaining({
          profileSignals: expect.objectContaining({
            marketSelection: expect.objectContaining({
              targetMarkets: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"],
              secondaryMarkets: expect.arrayContaining([
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
              ]),
              marketSource: "profile"
            })
          })
        })
      })
    });
  });

  it("sends a compact buyer-led search planning input to GPT instead of the full product pool", async () => {
    const prisma = createPrismaMock();
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    ai.analyzeProductProfile.mockResolvedValueOnce({
      brandName: "TeleCoreNet",
      websiteUrl: "https://telecorenet.com/",
      productCategories: Array.from({ length: 20 }, (_, index) => `Category ${index + 1}`),
      keyProducts: Array.from({ length: 158 }, (_, index) => `Generic SKU ${index + 1}`),
      targetUseCases: Array.from({ length: 30 }, (_, index) => `Use case ${index + 1}`),
      buyerPainPoints: Array.from({ length: 20 }, (_, index) => `Pain ${index + 1}`),
      supplyCapabilities: Array.from({ length: 20 }, (_, index) => `Capability ${index + 1}`),
      searchKeywords: Array.from({ length: 80 }, (_, index) => `keyword ${index + 1}`),
      negativeKeywords: ["jobs", "training", "phone"],
      confidence: 0.8,
      evidence: Array.from({ length: 20 }, (_, index) => `Evidence ${index + 1}`)
    });
    ai.expandKeywords.mockResolvedValueOnce({
      primaryProducts: [
        "telecom equipment",
        "RRU",
        "BBU",
        "AAU",
        "OLT",
        "SFP",
        "rectifier module",
        "microwave backhaul",
        "DAS equipment",
        "small cell equipment",
        "communication cables",
        "industrial network"
      ],
      relatedProducts: Array.from({ length: 40 }, (_, index) => `Huawei RRU ${3900 + index}`),
      longTailProducts: Array.from({ length: 60 }, (_, index) => `Ericsson AIR ${6400 + index}`),
      upstreamDownstreamTerms: [
        "base station maintenance",
        "FTTH operations",
        "vendor registration",
        "procurement portal"
      ],
      purchaseIntentTerms: [
        "telecom maintenance contractor",
        "ISP network operations",
        "RFQ",
        "tender",
        "procurement"
      ],
      targetMarketTerms: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"],
      industryScenarioTerms: [
        "5G network maintenance",
        "cell site power maintenance",
        "RFQ portal"
      ],
      exclusionTerms: ["jobs", "careers", "news", "phone", "email"]
    });
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment customers",
      targetCount: 20
    });

    const aiInput = ai.generateSearchStrategy.mock.calls[0]?.[0] as any;
    expect(aiInput.productProfile.keyProducts).toHaveLength(24);
    expect(aiInput.productProfile.productCategories).toHaveLength(8);
    expect(aiInput.keywordGroups.primaryProducts.length).toBeLessThanOrEqual(8);
    expect(aiInput.keywordGroups.relatedProducts.length).toBeLessThanOrEqual(14);
    expect(aiInput.keywordGroups.longTailProducts.length).toBeLessThanOrEqual(16);
    expect(aiInput.keywordGroups.purchaseIntentTerms.join(" ")).not.toMatch(
      /\b(?:rfq|tender|procurement)\b/i
    );
    expect(aiInput.keywordGroups.exclusionTerms.join(" ")).not.toMatch(/\b(?:phone|email|news)\b/i);
    expect(aiInput.operatorLibrary.templates).toEqual([]);
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
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

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
              profileMarkets: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"],
              secondaryMarkets: [],
              marketSource: "prompt"
            })
          })
        })
      })
    });
  });

  it("fails planning instead of filling deterministic fallback when GPT returns manual-only queries", async () => {
    const prisma = createPrismaMock();
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets).map((query) => ({
        ...query,
        executionStatus: "manual_only"
      }))
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment customers",
      targetCount: 20
    });

    // 2026-05: With Lane K (backend-assembled keyword queries), even
    // when GPT returns only manual_only queries (all rejected), the
    // system still produces Lane K queries from the keyword pool. The
    // task no longer fails — it proceeds with Lane K queries only.
    expect(result.searchQueries.length).toBeGreaterThan(0);
    // Lane K queries should be present
    expect(result.searchQueries.some((q) => q.templateId?.startsWith("lane_k_"))).toBe(true);
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", nodeName: "plan_search_queries" },
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("No deterministic fallback queries were added")
      })
    });
    expect(prisma.leadTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputPayload: expect.objectContaining({
          profileSignals: expect.objectContaining({
            aiPlanning: expect.objectContaining({
              gptSearchQueryCount: 0,
              fallbackQueryCount: 0,
              rejectedQueryCount: 30
            })
          })
        })
      })
    });
  });

  it("accepts ISO coreQuery output, enables channel queries, and appends backend exclusions", async () => {
    const prisma = createPrismaMock();
    const makeCoreQueries = (offset: number) =>
      Array.from({ length: 15 }, (_, index) => {
        const absoluteIndex = offset + index;
        const isChannel = absoluteIndex % 5 === 4;
        const isUae = absoluteIndex % 2 === 0;
        const countryName = isUae ? "UAE" : "Saudi Arabia";
        const country = isUae ? "AE" : "SA";
        const product = absoluteIndex % 3 === 0 ? "RRU BBU" : "5G telecom equipment";
        const buyer = isChannel
          ? "telecom equipment distributor"
          : absoluteIndex === 0
            ? "private 5G solutions"
            : absoluteIndex === 1
              ? "field engineering"
              : absoluteIndex === 2
                ? "telecom power service"
              : absoluteIndex % 3 === 1
                ? "telecom system integrator"
                : "base station maintenance company";

        return {
          id: `Q${String(absoluteIndex + 1).padStart(2, "0")}`,
          coreQuery: `"${buyer}" "${product}" ${countryName} contact project ${absoluteIndex + 1} ${
            absoluteIndex === 0 ? "-phone" : ""
          }`.trim(),
          country,
          countryName,
          language: "en",
          operatorSource: "brave_official",
          engineCompatibility: "supported",
          rationale: "Buyer role plus product",
          strategyType: isChannel ? "channel_customer" : "main_customer",
          intelligenceType: "none",
          expectedResultType: "company_site",
          buyerIntent: isChannel ? "distribution" : "maintenance",
          productEvidence: [product],
          customerEvidence: [buyer],
          confidence: "high",
          priority: index + 1
        };
      });
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: makeCoreQueries(input.refillContext ? 15 : 0)
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find UAE and Saudi Arabia 5G telecom equipment customers",
      targetCount: 20
    });
    const queryText = result.searchQueries.map((query) => query.query).join("\n");

    expect(ai.generateSearchStrategy).toHaveBeenCalledTimes(2);
    expect(ai.generateSearchStrategy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        minQueryCount: 15,
        targetMarketProfiles: expect.arrayContaining([
          expect.objectContaining({ country: "AE", countryName: "UAE" }),
          expect.objectContaining({ country: "SA", countryName: "Saudi Arabia" })
        ])
      })
    );
    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
    expect(new Set(result.searchQueries.map((query) => query.country))).toEqual(
      new Set(["UAE", "Saudi Arabia"])
    );
    expect(result.searchQueries.some((query) => query.strategyType === "channel_customer")).toBe(
      true
    );
    expect(queryText).toContain('"private 5G solutions"');
    expect(queryText).toContain('"field engineering"');
    expect(queryText).toContain('"telecom power service"');
    // 2026-05: backend no longer concatenates -site:/-inurl: exclusions
    // into the query text. Brave does not honor them reliably and they
    // burn scarce query-length budget; post-search candidate filtering
    // does the actual rejection. Assert the new behavior here.
    expect(queryText).not.toContain("-site:alibaba.com");
    expect(queryText).not.toContain("-inurl:.cn");
    expect(queryText).not.toMatch(/-phone\b/i);
  });

  it("accepts a partial 15-query GPT plan when Lane K fills the gap", async () => {
    const prisma = createPrismaMock();
    const ai = createLeadHuntAiMock(async (input) => {
      if (input.refillContext) {
        throw new Error("refill unavailable");
      }

      return {
        queries: simpleAiQueriesForMarkets(input.targetMarkets).slice(0, 15)
      };
    });
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment customers",
      targetCount: 20
    });

    // 2026-05: With Lane K, 15 GPT queries + Lane K keyword queries
    // exceeds the 30-query threshold, so the task succeeds instead of
    // failing. Lane K acts as a safety net for partial GPT plans.
    expect(ai.generateSearchStrategy).toHaveBeenCalledTimes(2);
    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
    expect(result.searchQueries.some((q) => q.templateId?.startsWith("lane_k_"))).toBe(true);
  });

  it("asks GPT for a refill when valid long-tail queries are rejected before reaching 20", async () => {
    const prisma = createPrismaMock();
    const ai = createLeadHuntAiMock(async (input) => {
      if (input.refillContext) {
        return {
          queries: simpleAiQueriesForMarkets(input.targetMarkets)
            .slice(10, 20)
            .map((query, index) => ({ ...query, priority: index + 1 }))
        };
      }

      // Return 12 valid + 8 invalid (rejected by quality gate) = 12 accepted
      return {
        queries: [
          ...simpleAiQueriesForMarkets(input.targetMarkets).slice(0, 12),
          ...Array.from({ length: 8 }, (_, index) =>
            aiSearchQuery(
              `infrastructure equipment service ${input.targetMarkets[index % input.targetMarkets.length]}`,
              input.targetMarkets[index % input.targetMarkets.length] ?? "UAE",
              index + 13,
              "model_specific"
            )
          )
        ]
      };
    });
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment customers",
      targetCount: 20
    });

    expect(ai.generateSearchStrategy).toHaveBeenCalledTimes(2);
    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
  });

  it("asks GPT for a second repair refill when the first refill is still one query short", async () => {
    const prisma = createPrismaMock();
    const ai = createLeadHuntAiMock(async (input) => {
      if (input.refillContext?.acceptedQueries.length === 29) {
        return {
          queries: simpleAiQueriesForMarkets(input.targetMarkets)
            .slice(29, 30)
            .map((query) => ({ ...query, priority: 1 }))
        };
      }

      if (input.refillContext) {
        return {
          queries: simpleAiQueriesForMarkets(input.targetMarkets)
            .slice(15, 29)
            .map((query, index) => ({ ...query, priority: index + 1 }))
        };
      }

      return {
        queries: simpleAiQueriesForMarkets(input.targetMarkets).slice(0, 15)
      };
    });
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment customers",
      targetCount: 20
    });
    const persistedPayload = prisma.leadTask.create.mock.calls[0]?.[0].data.inputPayload;

    expect(ai.generateSearchStrategy).toHaveBeenCalled();
    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
    expect(persistedPayload.profileSignals.aiPlanning).toEqual(
      expect.objectContaining({
        gptSearchQueryCount: expect.any(Number),
        gptRefillAttempts: expect.any(Number),
        gptRefillAcceptedCount: expect.any(Number),
        fallbackQueryCount: 0
      })
    );
    expect(prisma.searchQuery.createMany).toHaveBeenCalled();
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
        aiSearchQuery(
          '("Huawei MA5800" OR "Huawei MA5608T") Canada OLT supplier price datasheet -jobs -news',
          "Canada",
          4
        ),
        ...simpleAiQueriesForMarkets(input.targetMarkets).map((query, index) => ({
          ...query,
          priority: index + 5
        }))
      ]
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find Canada and Australia 5G telecom maintenance buyers",
      targetCount: 20
    });
    const queryText = result.searchQueries.map((query) => query.query).join("\n");
    const persistedPayload = prisma.leadTask.create.mock.calls[0]?.[0].data.inputPayload;

    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
    expect(new Set(result.searchQueries.map((query) => query.country))).toEqual(
      new Set(["Canada", "Australia"])
    );
    expect(queryText).not.toMatch(/\bRussia\b/i);
    expect(queryText).not.toMatch(/\bUAE\b/i);
    expect(queryText).not.toMatch(/\bUkraine\b/i);
    expect(queryText).not.toMatch(/\bIran\b/i);
    expect(queryText).not.toContain("site:.ru");
    expect(queryText).not.toContain('"Australia telecom tower maintenance"');
    expect(queryText).not.toContain("supplier price datasheet");
    expect(queryText).not.toMatch(/-(?:pdf|news|blog|report)\b/i);
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
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      websiteContent as any,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find 5G telecom equipment related buyer customers",
      targetCount: 20
    });

    expect(websiteContent.readProfileSites).toHaveBeenCalledWith({
      productUrls: [
        "https://telecorenet.com/",
        "https://telecorenet.com/products",
        "https://telecorenet.com/catalog.pdf"
      ],
      referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"]
    });
    expect(result.searchQueries[0]?.keywordGroups.productTerms).toEqual(
      expect.arrayContaining(["Ericsson AIR", "Huawei WBBP"])
    );
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
            keyProducts: expect.arrayContaining(["RRU", "BBU"])
          }),
          customerProfileAnalysis: expect.objectContaining({
            idealCustomerTypes: expect.arrayContaining(["telecom maintenance contractor"])
          }),
          profileSignals: expect.objectContaining({
            productUrlsRead: ["https://telecorenet.com/products"],
            failedUrlCount: 1,
            aiPlanning: expect.objectContaining({
              querySource: "gpt55_only",
              gptSearchQueryCount: expect.any(Number),
              fallbackQueryCount: 0
            })
          })
        })
      })
    });
  });

  it("falls back to task text and default keyword groups when profiles are missing", async () => {
    const prisma = createPrismaMock();
    prisma.productProfile.findUnique.mockResolvedValue(null);
    prisma.customerProfile.findUnique.mockResolvedValue(null);
    const ai = createLeadHuntAiMock(async (input) => ({
      queries: simpleAiQueriesForMarkets(input.targetMarkets)
    }));
    const service = new AgentWorkflowService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      ai as any
    );

    const result = await service.createTaskWithTimeline("user-1", {
      prompt: "Find Qatar microwave backhaul integrators"
    });

    expect(result.searchQueries.length).toBeGreaterThanOrEqual(20);
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
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

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
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

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

  it("passes full target-market context to qualification instead of only the query country pool", async () => {
    const prisma = createPrismaMock();
    prisma.leadTask.findFirst.mockResolvedValueOnce({
      id: "task-1",
      userId: "user-1",
      inputPayload: {
        customerProfile: {
          targetRegions: ["Middle East", "Africa", "Brazil", "Russia", "Ukraine"]
        },
        keywordGroups: {
          productTerms: ["telecom equipment", "RRU", "BBU"],
          longTailProductTerms: ["Huawei RRU spare parts"],
          customerIntentTerms: ["telecom contractor", "tower maintenance"],
          marketTerms: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"]
        }
      },
      searchQueries: [
        {
          id: "query-1",
          query: "telecom contractor Oman contact",
          country: "Oman",
          createdAt: new Date("2026-04-30T01:00:00.000Z")
        }
      ]
    });
    // 2026-05 V1-MVP Step 4: polling runner reads pending queries via
    // searchQuery.findFirst, not leadTask.findFirst include. Mirror
    // the per-test override here so the polling loop sees one pending
    // query with country=Oman, then null.
    prisma.searchQuery.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        id: "query-1",
        query: "telecom contractor Oman contact",
        country: "Oman",
        createdAt: new Date("2026-04-30T01:00:00.000Z")
      })
      .mockResolvedValue(null);
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

    await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(leadQualification.saveCandidates).toHaveBeenCalledWith(
      "task-1",
      expect.any(Array),
      expect.objectContaining({
        targetRegions: expect.arrayContaining([
          "UAE",
          "Saudi Arabia",
          "Qatar",
          "Oman",
          "Kuwait",
          "Middle East",
          "Africa",
          "Brazil",
          "Russia",
          "Ukraine"
        ])
      }),
      "Oman"
    );
  });

  it("does not count macro-market countries as country issues in the first-stage quality gate", async () => {
    const prisma = createPrismaMock();
    prisma.leadTask.findUnique.mockResolvedValueOnce({
      inputPayload: {
        customerProfile: {
          targetRegions: ["Middle East", "Africa", "Brazil", "Russia", "Ukraine"]
        },
        keywordGroups: {
          productTerms: ["telecom equipment", "RRU", "BBU"],
          customerIntentTerms: ["telecom contractor", "tower maintenance"],
          marketTerms: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"]
        }
      }
    });
    prisma.leadCandidate.findMany.mockResolvedValueOnce([
      {
        status: "review",
        country: "BAHRAIN",
        countryConfidence: "high",
        countryConflict: false
      },
      {
        status: "qualified",
        country: "SAUDI ARABIA",
        countryConfidence: "high",
        countryConflict: false
      }
    ]);
    prisma.searchQuery.count.mockResolvedValueOnce(15);
    const service = new AgentWorkflowService(prisma as any);

    const result = await (service as any).evaluateFirstStageSearchQuality("task-1");

    expect(result.countryIssueCandidates).toBe(0);
    expect(result.shouldStop).toBe(false);
  });

  it("marks failed Brave searches without breaking the whole task endpoint", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    braveSearch.searchAndSaveResults
      .mockRejectedValueOnce(new Error("Brave HTTPS request timed out"))
      .mockRejectedValueOnce(new Error("Brave HTTPS request timed out"));
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

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

  it("does not retry a failed Brave query with country=US (the legacy retry was removed)", async () => {
    // 2026-05: the legacy "fallback to country=US on first failure"
    // path was removed because Brave's country parameter is unreliable
    // and the US locale never improves relevance for non-US targets.
    // We assert here that the second call to searchAndSaveResults is
    // never made (no retry) and the original error surfaces.
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    braveSearch.searchAndSaveResults.mockRejectedValueOnce(
      new Error("Brave country parameter failed")
    );
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

    const result = await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(result).toMatchObject({
      ok: false,
      executedQueries: 1,
      successfulQueries: 0,
      failedQueries: 1,
      resultCount: 0,
      createdCandidates: 0,
      fallback: false
    });
    expect(braveSearch.searchAndSaveResults).toHaveBeenCalledTimes(1);
  });

  it("runs all pending searches when no explicit limit is provided", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    // 2026-05 V1-MVP Step 4: polling runner. With no limit, the loop
    // should drain all pending queries — simulate two pending then
    // null to terminate. Both queries should be processed.
    prisma.searchQuery.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        id: "query-1",
        query: "telecom equipment distributor UAE",
        country: "UAE",
        createdAt: new Date("2026-04-30T01:00:00.000Z")
      })
      .mockResolvedValueOnce({
        id: "query-2",
        query: "RRU stockist UAE",
        country: "UAE",
        createdAt: new Date("2026-04-30T01:00:01.000Z")
      })
      .mockResolvedValue(null);
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

    await service.executeBraveSearchForTask("user-1", "task-1");

    // Both queries processed — searchAndSaveResults called twice.
    expect(braveSearch.searchAndSaveResults).toHaveBeenCalledTimes(2);
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
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

    await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    expect(braveSearch.searchAndSaveResults).toHaveBeenCalledWith(
      "query-1",
      expect.objectContaining({
        count: 20
      })
    );
    expect(leadQualification.saveCandidates.mock.calls[0]?.[1]).toHaveLength(20);
  });

  it("preserves pending queries without generating fallback suggestions when the first-stage quality gate trips", async () => {
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

    const result = await (service as any).preservePendingQueriesAfterQualityGate("task-1", {
      reasons: ["country_issue_ratio_high"],
      executedQueryCount: 15
    });

    expect(result).toMatchObject({
      action: "preserved_pending_queries_after_quality_gate",
      rewrittenCount: 0,
      removedPendingCount: 0,
      preservedPendingCount: 2,
      remainingQueries: 2,
      reasons: ["country_issue_ratio_high"]
    });
    expect(result.suggestedFallbackQueryCount).toBeUndefined();
    expect(result.suggestedFallbackQueries).toBeUndefined();
    expect(prisma.searchQuery.updateMany).not.toHaveBeenCalled();
    expect(prisma.searchQuery.deleteMany).not.toHaveBeenCalled();
    expect(prisma.searchQuery.createMany).not.toHaveBeenCalled();
    expect(prisma.leadTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({
        inputPayload: expect.objectContaining({
          profileSignals: expect.objectContaining({
            qualityGate: expect.objectContaining({
              action: "preserved_pending_queries_after_quality_gate",
              pendingQueryCount: 2,
              remainingQueries: 2
            }),
            qualityFallbackSuggestion: null
          })
        })
      })
    });
  });

  it("marks candidate save errors per query without failing the query itself", async () => {
    const prisma = createPrismaMock();
    const braveSearch = createBraveSearchMock();
    const leadQualification = createLeadQualificationMock();
    leadQualification.saveCandidates.mockRejectedValueOnce(
      new Error("candidate enrichment failed")
    );
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

    const result = await service.executeBraveSearchForTask("user-1", "task-1", { limit: 1 });

    // 2026-05 P0: saveCandidates failure no longer marks the query as
    // failed. Brave search succeeded (results saved), so the query is
    // "completed" with resultCount preserved. The save error is
    // recorded in errors[] but does not count as a query failure.
    expect(result).toMatchObject({
      ok: true,
      executedQueries: 1,
      failedQueries: 0,
      errors: [{ queryId: "query-1", message: expect.stringContaining("saveCandidates failed") }]
    });
    // Query stays completed with resultCount preserved
    expect(prisma.searchQuery.update).toHaveBeenCalledWith({
      where: { id: "query-1" },
      data: {
        executionStatus: "completed",
        resultCount: 1,
        qualifiedCount: 0
      }
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
    const service = new AgentWorkflowService(
      prisma as any,
      braveSearch as any,
      leadQualification as any
    );

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

  // 2026-05 V1-MVP: directly test splitReferenceCompanyAliases. The
  // qualification-layer tests in lead-qualification.service.spec.ts
  // pass pre-split arrays, so they don't actually exercise this helper.
  // Without this test, a regression in the splitter (e.g. forgetting
  // to handle " aka ", or breaking on multiple separators) would
  // silently slip through.
  describe("splitReferenceCompanyAliases", () => {
    it("splits combined names on / separator and keeps the original", () => {
      expect(splitReferenceCompanyAliases("HighCloud / HCT Group")).toEqual([
        "HighCloud / HCT Group",
        "HighCloud",
        "HCT Group"
      ]);
    });

    it("splits on , and ; separators", () => {
      expect(splitReferenceCompanyAliases("ABC, XYZ; LMN")).toEqual([
        "ABC, XYZ; LMN",
        "ABC",
        "XYZ",
        "LMN"
      ]);
    });

    it("splits on case-insensitive ' aka ' separator", () => {
      expect(splitReferenceCompanyAliases("ACME AKA Acme Corp")).toEqual([
        "ACME AKA Acme Corp",
        "ACME",
        "Acme Corp"
      ]);
    });

    it("returns the trimmed name unchanged when there is no separator", () => {
      expect(splitReferenceCompanyAliases("  HCT Group  ")).toEqual(["HCT Group"]);
    });

    it("returns an empty array for empty or whitespace input", () => {
      expect(splitReferenceCompanyAliases("")).toEqual([]);
      expect(splitReferenceCompanyAliases("   ")).toEqual([]);
    });
  });

  // 2026-05 V1-MVP+: query-level worker pool tests. The pool spawns
  // N concurrent workers that share an atomic claim mechanism. Tests
  // verify (1) each query is processed exactly once, (2) the queryLimit
  // budget is not exceeded by races, (3) the env-config resolver
  // clamps to safe bounds.
  describe("resolveSearchQueryConcurrency", () => {
    const original = process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY;
    afterEach(() => {
      if (original === undefined) delete process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY;
      else process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = original;
    });

    it("defaults to 3 when env var is not set", () => {
      delete process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY;
      expect(resolveSearchQueryConcurrency()).toBe(3);
    });

    it("respects the configured value within bounds", () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "4";
      expect(resolveSearchQueryConcurrency()).toBe(4);
    });

    it("clamps low values to the minimum (1)", () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "0";
      expect(resolveSearchQueryConcurrency()).toBe(1);
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "-5";
      expect(resolveSearchQueryConcurrency()).toBe(1);
    });

    it("clamps high values to the maximum (5)", () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "10";
      expect(resolveSearchQueryConcurrency()).toBe(5);
    });

    it("falls back to the minimum on non-numeric input", () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "abc";
      expect(resolveSearchQueryConcurrency()).toBe(1);
    });
  });

  describe("brave_search worker pool", () => {
    const originalConcurrency = process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY;
    afterEach(() => {
      if (originalConcurrency === undefined) {
        delete process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY;
      } else {
        process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = originalConcurrency;
      }
    });

    function makePoolPrismaMock(pendingQueries: Array<{ id: string; query: string; country: string }>) {
      const queue = [...pendingQueries];
      const claimedSet = new Set<string>();
      const completedSet = new Set<string>();
      const prisma = createPrismaMock();

      // findFirst returns the next un-claimed pending query.
      prisma.searchQuery.findFirst = vi.fn().mockImplementation(async () => {
        const next = queue.find((q) => !claimedSet.has(q.id));
        if (!next) return null;
        return {
          id: next.id,
          query: next.query,
          country: next.country,
          createdAt: new Date()
        };
      });

      // updateMany simulates atomic claim. The first worker to call
      // wins; subsequent calls for the same id return count=0.
      // Cleanup path (executionStatus="running") returns count=0
      // because in this mock, the worker pool finishes cleanly.
      prisma.searchQuery.updateMany = vi
        .fn()
        .mockImplementation(async ({ where, data }: any) => {
          if (where?.id && where?.executionStatus === "pending") {
            if (claimedSet.has(where.id)) return { count: 0 };
            claimedSet.add(where.id);
            return { count: 1 };
          }
          if (where?.executionStatus === "running") {
            // No leftover running queries in this mock.
            return { count: 0 };
          }
          return { count: 1 };
        });

      // update tracks which queries reached "completed" status so
      // findMany (used by aggregateSearchQueryStats) can return the
      // right row count.
      prisma.searchQuery.update = vi.fn().mockImplementation(async ({ where, data }: any) => {
        if (where?.id && data?.executionStatus === "completed") {
          completedSet.add(where.id);
        }
        return {};
      });

      // findMany returns one row per claimed (and finalized) query so
      // aggregateSearchQueryStats reports the right totals.
      prisma.searchQuery.findMany = vi.fn().mockImplementation(async () => {
        return Array.from(completedSet).map(() => ({
          executionStatus: "completed",
          resultCount: 1
        }));
      });

      return { prisma, queue, claimedSet, completedSet };
    }

    it("processes each pending query exactly once with 3 workers", async () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "3";
      const queries = Array.from({ length: 8 }, (_, i) => ({
        id: `q-${i + 1}`,
        query: `keyword ${i + 1}`,
        country: "UAE"
      }));
      const { prisma } = makePoolPrismaMock(queries);
      const braveSearch = createBraveSearchMock();
      const leadQualification = createLeadQualificationMock();
      const service = new AgentWorkflowService(
        prisma as any,
        braveSearch as any,
        leadQualification as any
      );

      const result = await service.executeBraveSearchForTask("user-1", "task-1");

      // Each query processed exactly once: searchAndSaveResults is called
      // once per query (race losers don't proceed).
      expect(braveSearch.searchAndSaveResults).toHaveBeenCalledTimes(8);
      expect(result.executedQueries).toBe(8);
      expect(result.successfulQueries).toBe(8);
      expect(result.failedQueries).toBe(0);
    });

    it("respects queryLimit across workers without going over budget", async () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "3";
      const queries = Array.from({ length: 10 }, (_, i) => ({
        id: `q-${i + 1}`,
        query: `keyword ${i + 1}`,
        country: "UAE"
      }));
      const { prisma } = makePoolPrismaMock(queries);
      const braveSearch = createBraveSearchMock();
      const leadQualification = createLeadQualificationMock();
      const service = new AgentWorkflowService(
        prisma as any,
        braveSearch as any,
        leadQualification as any
      );

      // Limit to 5 of the 10 pending. With 3 workers there must be no
      // over-claim race producing 6 or 7 executed queries.
      const result = await service.executeBraveSearchForTask("user-1", "task-1", {
        limit: 5
      });

      expect(braveSearch.searchAndSaveResults.mock.calls.length).toBeLessThanOrEqual(5);
      expect(result.executedQueries).toBeLessThanOrEqual(5);
    });

    it("does not double-process when 5 workers race on the same pending queue", async () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "5";
      const queries = Array.from({ length: 12 }, (_, i) => ({
        id: `q-${i + 1}`,
        query: `keyword ${i + 1}`,
        country: "UAE"
      }));
      const { prisma } = makePoolPrismaMock(queries);
      const braveSearch = createBraveSearchMock();
      const leadQualification = createLeadQualificationMock();
      const service = new AgentWorkflowService(
        prisma as any,
        braveSearch as any,
        leadQualification as any
      );

      await service.executeBraveSearchForTask("user-1", "task-1");

      // searchAndSaveResults is called with each unique query id at
      // most once. Build the set of query ids passed in:
      const seenIds = new Set(
        braveSearch.searchAndSaveResults.mock.calls.map((call: any[]) => call[0])
      );
      expect(seenIds.size).toBe(12); // exactly 12 unique queries
      expect(braveSearch.searchAndSaveResults).toHaveBeenCalledTimes(12);
    });

    // 2026-05 V1-MVP+ P1 fix: idle timeout (not total cap) governs
    // worker exit. A long but progressing task must NOT be truncated
    // at 10min. A truly stuck task (no claim, no progress) is still
    // killed by the IDLE_TIMEOUT_MS watchdog.
    it("processes all queries even when total elapsed time would exceed the legacy 10min cap", async () => {
      // We can't actually wait 10min in a unit test. Instead we verify
      // the EMERGENCY cap is at least 30min (a safe upper bound). This
      // is a structural guard that catches regressions where someone
      // re-introduces a 10min total cap.
      const sourceText = (await import("node:fs")).readFileSync(
        new URL("./agent-workflow.service.ts", import.meta.url),
        "utf-8"
      );
      // EMERGENCY_TIMEOUT_MS must be >= 30min; IDLE_TIMEOUT_MS may be
      // smaller but should not be the sole termination mechanism.
      const emergencyMatch = sourceText.match(/EMERGENCY_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
      expect(emergencyMatch).not.toBeNull();
      const emergencyMs =
        Number(emergencyMatch![1]) * Number(emergencyMatch![2]) * Number(emergencyMatch![3]);
      expect(emergencyMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
    });

    // 2026-05 V1-MVP+ P1: remainingQueries > 0 semantics.
    // When queryLimit is NOT set (autonomous path) and pending queries
    // remain after the worker pool exits, the result must be ok=false
    // and brave_search must NOT be marked completed.
    it("returns ok=false when autonomous path exits with pending queries remaining", async () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "2";
      // Set up 5 queries but make findFirst only return 2 then null
      // (simulating idle timeout — slow planning settled but queries
      // were never inserted, or workers crashed).
      const prisma = createPrismaMock();
      let callCount = 0;
      prisma.searchQuery.findFirst = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return { id: `q-${callCount}`, query: `kw ${callCount}`, country: "UAE", createdAt: new Date() };
        }
        return null;
      });
      prisma.searchQuery.updateMany = vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.executionStatus === "running") return { count: 0 };
        return { count: 1 };
      });
      // After workers exit, countPendingSearchQueries returns 3
      // (simulating 3 queries that were never claimed).
      prisma.searchQuery.count = vi.fn().mockResolvedValue(3);
      prisma.searchQuery.findMany = vi.fn().mockResolvedValue([
        { executionStatus: "completed", resultCount: 1 },
        { executionStatus: "completed", resultCount: 1 },
        { executionStatus: "pending", resultCount: 0 },
        { executionStatus: "pending", resultCount: 0 },
        { executionStatus: "pending", resultCount: 0 }
      ]);
      const braveSearch = createBraveSearchMock();
      const leadQualification = createLeadQualificationMock();
      const service = new AgentWorkflowService(
        prisma as any,
        braveSearch as any,
        leadQualification as any
      );

      // No queryLimit → autonomous path. Should return ok=false.
      const result = await service.executeBraveSearchForTask("user-1", "task-1");

      expect(result.ok).toBe(false);
      expect(result.hasMore).toBe(true);
      expect(result.remainingQueries).toBe(3);
      // brave_search should be marked FAILED, not completed.
      expect(prisma.agentStep.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: "task-1", nodeName: "brave_search" },
          data: expect.objectContaining({ status: "failed" })
        })
      );
    });

    // When queryLimit IS set (batch path), hasMore=true is expected
    // and ok=true is correct.
    it("returns ok=true with hasMore when queryLimit is set and pending remain", async () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "2";
      const queries = Array.from({ length: 8 }, (_, i) => ({
        id: `q-${i + 1}`,
        query: `keyword ${i + 1}`,
        country: "UAE"
      }));
      const { prisma } = makePoolPrismaMock(queries);
      // After limit=3 is consumed, countPendingSearchQueries returns 5.
      prisma.searchQuery.count = vi.fn().mockResolvedValue(5);
      // aggregateSearchQueryStats also calls findMany — include pending
      // entries so it computes hasMore=true.
      prisma.searchQuery.findMany = vi.fn().mockResolvedValue([
        { executionStatus: "completed", resultCount: 1 },
        { executionStatus: "completed", resultCount: 1 },
        { executionStatus: "completed", resultCount: 1 },
        { executionStatus: "pending", resultCount: 0 },
        { executionStatus: "pending", resultCount: 0 },
        { executionStatus: "pending", resultCount: 0 },
        { executionStatus: "pending", resultCount: 0 },
        { executionStatus: "pending", resultCount: 0 }
      ]);
      const braveSearch = createBraveSearchMock();
      const leadQualification = createLeadQualificationMock();
      const service = new AgentWorkflowService(
        prisma as any,
        braveSearch as any,
        leadQualification as any
      );

      const result = await service.executeBraveSearchForTask("user-1", "task-1", {
        limit: 3
      });

      // With queryLimit set, hasMore=true is expected, ok=true.
      expect(result.ok).toBe(true);
      expect(result.hasMore).toBe(true);
    });

    // 2026-05 V1-MVP+ P1 fix: stale running queries left by crashed
    // workers must be reset to pending so a later pass (or recovery)
    // can re-claim them. Verify the worker pool calls updateMany with
    // {executionStatus:"running"} → {executionStatus:"pending"} after
    // the workers finish.
    it("resets stale running queries to pending after workers exit", async () => {
      process.env.LEADHUNT_SEARCH_QUERY_CONCURRENCY = "2";
      const queries = [
        { id: "q-1", query: "k1", country: "UAE" },
        { id: "q-2", query: "k2", country: "UAE" }
      ];
      const { prisma } = makePoolPrismaMock(queries);
      const braveSearch = createBraveSearchMock();
      const leadQualification = createLeadQualificationMock();
      const service = new AgentWorkflowService(
        prisma as any,
        braveSearch as any,
        leadQualification as any
      );

      await service.executeBraveSearchForTask("user-1", "task-1");

      // The worker pool must call updateMany with the cleanup pattern
      // (where.executionStatus === "running", data.executionStatus ===
      // "pending") at least once after the workers finish.
      const cleanupCall = prisma.searchQuery.updateMany.mock.calls.find(
        ([args]: any[]) =>
          args?.where?.executionStatus === "running" &&
          args?.data?.executionStatus === "pending"
      );
      expect(cleanupCall).toBeDefined();
    });
  });
});
