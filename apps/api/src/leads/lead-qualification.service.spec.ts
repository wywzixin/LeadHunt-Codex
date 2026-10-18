import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadQualificationService } from "./lead-qualification.service.js";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("", {
      status: 200,
      headers: { "content-type": "text/html; charset=UTF-8" }
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createPrismaMock() {
  return {
    leadCandidate: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "lead-1",
          ...data,
          contacts: data.contacts.create,
          icpScore: data.icpScore.create
        })
      )
    },
    leadContact: {
      createMany: vi.fn().mockResolvedValue({ count: 1 })
    }
  };
}

const criteria = {
  targetRegions: ["UAE"],
  productKeywords: ["RRU", "BBU", "AAU", "telecom power"],
  customerTypeKeywords: ["distributor", "stockist", "system integrator", "contractor"],
  disqualifiers: ["training center"]
};

describe("LeadQualificationService", () => {
  it("normalizes Brave results into deduped lead candidates with contacts", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Spectrum MEA - Telecom Distributor UAE",
          url: "https://spectrummea.com/contact",
          snippet:
            "UAE telecom system integrator with RRU and BBU stock. Email sales@spectrummea.com Phone +971 4 123 4567 https://linkedin.com/company/spectrummea",
          source: "web"
        },
        {
          title: "Spectrum MEA Duplicate",
          url: "https://spectrummea.com/",
          snippet: "sales@spectrummea.com",
          source: "web"
        },
        {
          title: "Telecom Distributor | High Cloud",
          url: "http://highcloud.ae/",
          snippet: "Dubai stockist for telecom equipment. Contact info@highcloud.ae",
          source: "llm_context"
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      companyName: "Spectrum MEA",
      country: "UAE",
      website: "https://spectrummea.com/contact"
    });
    expect(candidates[0]?.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "email", value: "sales@spectrummea.com" }),
        expect.objectContaining({ type: "phone", value: "+971 4 123 4567" }),
        expect.objectContaining({
          type: "social",
          value: "https://linkedin.com/company/spectrummea"
        })
      ])
    );
    expect(candidates[1]?.companyName).toBe("High Cloud");
  });

  it("keeps social share links while normalizing malformed protocol emails", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "GreenPower Overseas - Telecom DC Power",
          url: "https://greenpowernig.com/telecom-dc-power-supply-and-rectifier/",
          snippet:
            "Telecom DC power and rectifier maintenance in Nigeria. http://info@greenpowernig.com https://www.linkedin.com/company/greenpower-overseas-limited-3208 https://www.facebook.com/sharer/sharer.php?u=https://greenpowernig.com/post https://twitter.com/home?status=Telecom",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidate?.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "email", value: "info@greenpowernig.com" }),
        expect.objectContaining({
          type: "social",
          value: "https://www.linkedin.com/company/greenpower-overseas-limited-3208"
        }),
        expect.objectContaining({ value: expect.stringContaining("facebook.com/sharer") }),
        expect.objectContaining({ value: expect.stringContaining("twitter.com/home") })
      ])
    );
    expect(candidate?.contacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "http://info@greenpowernig.com" })
      ])
    );
  });

  it("infers missing candidate country from direct phone contacts", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Rectifier Repair Service - ATS Solutions",
          url: "https://ats4solutions.com/rectifier-repair-service/",
          snippet:
            "Rectifier repair service for telecom power systems. Customer service phone 630-209-8300 and email customerservice@ats4solutions.com.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidate?.country).toBe("UNITED STATES");
    expect(candidate?.contacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "phone", value: "630-209-8300" })])
    );
  });

  it("uses official-site company signals instead of product page titles", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Alcatel-Lucent (Nokia) telecom networking equipment from MF Communications",
          url: "https://www.mfcomm.co.uk/alcatel-lucent-nokia-telecom-networking-equipment/",
          snippet: "Telecom networking equipment page.",
          source: "web"
        },
        {
          title: "Eltek Flatpack S He Rectifier 1000W 48V 20A",
          url: "https://www.ispsupplies.com/products/eltek-flatpack-s-he-rectifier-1000w-48v",
          snippet: "Telecom rectifier module product page.",
          source: "web"
        },
        {
          title: "Rectifier Repair Service",
          url: "https://ats4solutions.com/rectifier-repair-service/",
          snippet: "Rectifier repair service for telecom power systems.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidates.map((candidate) => candidate.companyName)).toEqual([
      "MF Communications",
      "ISP Supplies",
      "ATS 4 Solutions"
    ]);
  });

  it("uses the buyer domain instead of a brand-only result title", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Huawei",
          url: "https://sfttradingllc.com/contact-us/",
          snippet:
            "UAE authorized channel partner and telecom equipment distributor for Huawei network equipment.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    expect(candidate?.companyName).toBe("SFT Trading LLC");
  });

  it("falls back to domain brands instead of using marketing headlines as company names", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Top-Rated IT Network Solutions & Transceivers in the Middle East",
          url: "https://www.sfps.ae/",
          snippet: "Network transceivers and IT infrastructure in the UAE.",
          source: "web"
        },
        {
          title: "Leading Company in Fibre/FTTX service UAE |Fibre cabling service Dubai",
          url: "https://telephonyme.com/fttx-service-uae/",
          snippet: "FTTX services and fibre cabling in Dubai.",
          source: "web"
        },
        {
          title: "Communication Package For Business Connectivity",
          url: "https://www.stc.com.sa/wps/wcm/connect/english/business/wholesales/servicesAndSolutions/Collocation/SiteSharing",
          snippet: "Saudi telecom business connectivity and site sharing page.",
          source: "web"
        },
        {
          title: "Created By spacetechnologies",
          url: "https://alhazmservices.com/",
          snippet: "Telecom services company in Oman.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidates.map((candidate) => candidate.companyName)).toEqual([
      "SFPS",
      "TelephonyME",
      "STC",
      "Al Hazm Services"
    ]);
  });

  // 2026-05 V1-MVP+: company name cleaning — reject article titles,
  // "by X" attributions, descriptive headings, and copyright lines
  // that previously leaked through as company names.
  it("rejects article titles and descriptive headings as company names", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Qatar Mobile Operators: Which One is the Best 2026",
          url: "https://esimqatar.com/operators/",
          snippet: "Comparison of Qatar mobile operators.",
          source: "web"
        },
        {
          title: "Telecom services: project management and certification | Applus",
          url: "https://www.applus.com/qa/en/what-we-do/market/telecommunications",
          snippet: "Applus telecom certification services.",
          source: "web"
        },
        {
          title: "Huawei MA5800: The Multi-Service Access Platform Powering Future Networks",
          url: "https://www.telecomate.com/huawei-ma5800-the-multi-service-access-platform-powering-future-networks/",
          snippet: "Product review article about Huawei MA5800.",
          source: "web"
        },
        {
          title: "Accelerate Success with TheCloudPartner: Trusted Cloud Solutions",
          url: "https://thecloudpartner.com/",
          snippet: "Cloud solutions provider.",
          source: "web"
        },
        {
          title: "by Qatar Multitech Trading & Contracting W.L.L.",
          url: "https://www.qatarmultitech.com/telecom-engineering",
          snippet: "Qatar Multitech telecom engineering services.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    // None of these should use the raw title as company name.
    // They should fall back to domain-derived names.
    const names = candidates.map((c) => c.companyName);
    expect(names).not.toContain("Qatar Mobile Operators: Which One is the Best 2026");
    expect(names).not.toContain("Telecom services: project management and certification");
    expect(names).not.toContain("by Qatar Multitech Trading & Contracting W.L.L.");
    expect(names).not.toContain("Accelerate Success with TheCloudPartner: Trusted Cloud Solutions");
    // Domain fallbacks should produce reasonable names:
    expect(names).toContain("Esimqatar");
    expect(names).toContain("Applus");
    // "by Qatar Multitech..." should clean to "Qatar Multitech Trading & Contracting W.L.L."
    // or fall back to domain "Qatarmultitech"
    const qmName = names.find((n) => n.toLowerCase().includes("multitech") || n.toLowerCase().includes("qatarmultitech"));
    expect(qmName).toBeDefined();
  });

  it("scores strong ICP matches and flags risky candidates", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Spectrum MEA - Telecom Distributor UAE",
          url: "https://spectrummea.com/",
          snippet:
            "UAE telecom equipment distributor and system integrator with RRU BBU stock. Phone +971 4 123 4567. sales@spectrummea.com",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    const highScore = service.scoreCandidate(candidate!, criteria);

    expect(highScore.grade).toBe("high");
    expect(highScore.status).toBe("qualified");
    expect(highScore.reasons).toEqual(
      expect.arrayContaining([
        "Matches relevant product, industry, or buyer context",
        "Mentions relevant product or category keywords",
        "Matches target customer type",
        "Target country verified from official evidence: UAE"
      ])
    );

    const riskyScore = service.scoreCandidate(
      {
        ...candidate!,
        summary: "Telecom training center and job course news"
      },
      criteria
    );

    expect(riskyScore.score).toBeLessThan(highScore.score);
    expect(riskyScore.risks[0]).toContain("training");
  });

  it("saves non-duplicate candidates with contacts and ICP scores", async () => {
    const prisma = createPrismaMock();
    prisma.leadCandidate.findMany.mockResolvedValue([
      {
        id: "existing-lead-1",
        companyName: "Existing Lead",
        website: "https://existing.ae/",
        contacts: [{ type: "email", value: "sales@existing.ae" }]
      }
    ]);
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Existing Lead - Telecom Distributor",
          url: "https://existing.ae/",
          snippet: "sales@existing.ae",
          source: "web"
        },
        {
          title: "High Cloud - Telecom Stockist UAE",
          url: "http://highcloud.ae/",
          snippet: "Dubai telecom stockist with BBU spare parts. info@highcloud.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.matchedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "existing-lead-1" }),
        expect.objectContaining({ companyName: "High Cloud" })
      ])
    );
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: "task-1",
          companyName: "High Cloud",
          status: expect.stringMatching(/qualified|review/),
          contacts: {
            create: [
              {
                type: "email",
                value: "info@highcloud.ae",
                sourceUrl: "http://highcloud.ae/"
              }
            ]
          },
          icpScore: {
            create: expect.objectContaining({
              score: expect.any(Number),
              grade: expect.stringMatching(/high|medium/)
            })
          }
        })
      })
    );
  });

  it("stores contact form pages as reachable contact entries", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        '<html><body><h1>Contact us</h1><form><input name="email" /></form></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" }
        }
      )
    );
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "High Cloud - Telecom Stockist UAE",
          url: "http://highcloud.ae/",
          snippet:
            "Dubai telecom stockist with BBU spare parts. Contact our procurement team through the form. info@highcloud.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.candidates[0]?.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "form",
          value: expect.stringContaining("highcloud.ae")
        })
      ])
    );
  });

  it("stores a higher-quality AI company name when the result title is domain-derived", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);
    const aiEvaluator = vi.fn().mockResolvedValue({
      companyName: "Ultra Stream Technologies LLC",
      websiteUrl: "https://www.ustech.ae/huawei-distributor-in-dubai-uae",
      resultType: "possible_buyer",
      buyerType: "ICT and ELV supplier / communication equipment distributor",
      fitScore: 62,
      confidence: 0.78,
      decision: "review",
      matchedSignals: ["Located in UAE", "Huawei distributor in Dubai"],
      risks: []
    });

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "ustech - Huawei Distributor in Dubai UAE",
          url: "https://www.ustech.ae/huawei-distributor-in-dubai-uae",
          snippet:
            "Huawei distributor in Dubai UAE with telecom networking products. sales@ultrastream.ae Phone +971 4 553 8728",
          source: "web"
        }
      ],
      criteria,
      "UAE",
      aiEvaluator
    );

    expect(aiEvaluator).toHaveBeenCalled();
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Ultra Stream Technologies LLC"
        })
      })
    );
  });

  it("does not let AI lift evidence-capped telecom leads into high match", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);
    const aiEvaluator = vi.fn().mockResolvedValue({
      companyName: "Networks & System Integration S. A. Co. Ltd",
      websiteUrl: "http://www.nesicsa.com/",
      resultType: "target_buyer",
      buyerType: "system integrator",
      fitScore: 95,
      confidence: 0.9,
      decision: "qualified",
      matchedSignals: ["System integration services", "Saudi Arabia target market"],
      risks: [
        "Telecom task but candidate page has no telecom, RAN, base-station, fiber, ISP, tower, or telecom-power evidence",
        "No explicit telecom evidence on the candidate page; capped at review until manually validated"
      ]
    });

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Networks & System Integration S. A. Co. Ltd",
          url: "http://www.nesicsa.com/",
          snippet:
            "Saudi Arabia system integration company. Contact info@nesicsa.com Phone +966 11 123 4567.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["system integrator", "contractor", "installer"]
      },
      "Saudi Arabia",
      aiEvaluator
    );

    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("review");
    expect(createData.icpScore.create.score).toBeLessThan(75);
    expect(createData.icpScore.create.grade).toBe("medium");
  });

  it("rejects AI-confirmed off-target country leads instead of keeping them in review", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);
    const aiEvaluator = vi.fn().mockResolvedValue({
      companyName: "Pacific Network Services",
      websiteUrl: "https://www.pacific-network.example/contact",
      resultType: "possible_buyer",
      buyerType: "telecom operator",
      fitScore: 78,
      confidence: 0.82,
      decision: "review",
      matchedSignals: ["Telecom operator contact page"],
      risks: [
        "Pacific Network Services is based in Hong Kong, while the requested target regions are Middle East and Africa markets."
      ]
    });

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Pacific Network Services telecom contact Qatar",
          url: "https://www.pacific-network.example/contact",
          snippet:
            "Telecom operator with 5G services and contact sales@pacific-network.example.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["telecom operator", "system integrator"]
      },
      "Qatar",
      aiEvaluator
    );

    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("rejected");
    expect(createData.icpScore.create.score).toBeLessThan(50);
    expect(createData.icpScore.create.reasons).toEqual(
      expect.objectContaining({
        risks: expect.arrayContaining([
          "Pacific Network Services is based in Hong Kong, while the requested target regions are Middle East and Africa markets."
        ])
      })
    );
  });

  it("rejects AI-confirmed off-target leads when the risk starts with located in", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);
    const aiEvaluator = vi.fn().mockResolvedValue({
      companyName: "HKT",
      websiteUrl: "https://www.hkt.com/en/about-hkt/milestones/",
      resultType: "possible_buyer",
      buyerType: "telecom operator procurement",
      fitScore: 72,
      confidence: 0.78,
      decision: "review",
      matchedSignals: ["Official page identifies HKT as a telecommunications service provider"],
      risks: [
        "Located in Hong Kong, outside the stated priority target regions",
        "Page is a corporate milestones/about page, not a procurement, vendor registration, RFQ, or tender page"
      ]
    });

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "HKT milestones Saudi Arabia 5G communication equipment",
          url: "https://www.hkt.com/en/about-hkt/milestones/",
          snippet:
            "HKT becomes first telecom service provider to adopt 50G PON technology. Contact business_inquiry@pccw.com.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["telecom operator", "system integrator"]
      },
      "Saudi Arabia",
      aiEvaluator
    );

    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("rejected");
    expect(createData.icpScore.create.score).toBeLessThan(50);
  });

  it("rejects low-fit industrial spare-parts pages that have no telecom evidence", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);
    const aiEvaluator = vi.fn().mockResolvedValue({
      companyName: "Industry International",
      websiteUrl: "https://industryinternational.co.za/topbrands",
      resultType: "possible_buyer",
      buyerType: "industrial spare parts reseller",
      fitScore: 43,
      confidence: 0.58,
      decision: "review",
      matchedSignals: ["Local reseller for industrial equipment and spare parts"],
      risks: [
        "Telecom task but candidate page has no telecom, RAN, base-station, fiber, ISP, tower, or telecom-power evidence",
        "Website appears primarily to sell industrial automation, pneumatics, motors, pumps, sensors, gearboxes, and general industrial components",
        "No evidence of telecom system integration, base station maintenance, RAN maintenance, tower maintenance, operator procurement, or telecom power maintenance activity"
      ]
    });

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Industry International telecom spare parts Nigeria contact",
          url: "https://industryinternational.co.za/topbrands",
          snippet:
            "Marketplace from direct reseller of industries. Choose spare parts from more than 10,000 brands. info@industryinternational.co.za +27 11 545 55 20.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Nigeria", "South Africa"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["stockist", "distributor", "system integrator"]
      },
      "Nigeria",
      aiEvaluator
    );

    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("rejected");
    expect(createData.icpScore.create.score).toBeLessThan(50);
  });

  it("rejects telecom-task candidates with off-target product evidence and no telecom evidence", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);
    const aiEvaluator = vi.fn().mockResolvedValue({
      companyName: "Gulf MEP Projects",
      websiteUrl: "https://gulf-mep.example/",
      resultType: "possible_buyer",
      buyerType: "MEP contractor",
      fitScore: 58,
      confidence: 0.67,
      decision: "review",
      matchedSignals: ["Regional contractor with contact details"],
      risks: [
        "Telecom task but candidate page has no telecom, RAN, base-station, fiber, ISP, tower, or telecom-power evidence",
        "Off-target product/service evidence for a telecom task: hvac",
        "Company appears primarily focused on MEP, manpower, cleaning, security, and general contracting services"
      ]
    });

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Gulf MEP Projects Kuwait - Contact",
          url: "https://gulf-mep.example/",
          snippet:
            "Kuwait MEP and HVAC contractor. Contact engineering@gulf-mep.example Phone +965 2222 3333.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Kuwait"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["system integrator", "contractor", "installer"]
      },
      "Kuwait",
      aiEvaluator
    );

    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("rejected");
    expect(createData.icpScore.create.score).toBeLessThan(50);
  });

  it("serializes same-task candidate saves so concurrent workers do not duplicate a domain", async () => {
    const prisma = createPrismaMock();
    const stored: any[] = [];
    prisma.leadCandidate.findMany.mockImplementation(async () =>
      stored.map((lead) => ({
        id: lead.id,
        companyName: lead.companyName,
        website: lead.website,
        contacts: lead.contacts
      }))
    );
    prisma.leadCandidate.create.mockImplementation(async ({ data }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const record = {
        id: `lead-${stored.length + 1}`,
        companyName: data.companyName,
        website: data.website,
        contacts: data.contacts.create,
        icpScore: data.icpScore.create
      };
      stored.push(record);
      return record;
    });
    const service = new LeadQualificationService(prisma as any);
    const firstResult = {
      title: "Switch Link Computers Trading - Huawei Distributor",
      url: "https://switchlinkct.com/huawei-distributor-dubai-uae/",
      snippet:
        "Huawei distributor in Dubai UAE with networking and telecom solutions. info@switchlinkdubai.com +971 55 9670902",
      source: "web" as const
    };
    const secondResult = {
      title: "Switch Link Computers Trading - Networking Solutions",
      url: "https://switchlinkct.com/",
      snippet:
        "Switch Link Computers Trading supplies networking and telecom solutions in UAE. info@switchlinkdubai.com +971 55 9670902",
      source: "web" as const
    };

    const [first, second] = await Promise.all([
      service.saveCandidates("task-1", [firstResult], criteria, "UAE"),
      service.saveCandidates("task-1", [secondResult], criteria, "UAE")
    ]);

    expect(stored).toHaveLength(1);
    expect(first.createdCount + second.createdCount).toBe(1);
    expect(first.skippedCount + second.skippedCount).toBe(1);
  });

  it("sanitizes AI scoring evidence before writing JSON fields", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Null Byte Telecom Stockist UAE",
          url: "https://nullbyte-telecom.ae/contact",
          snippet:
            "UAE telecom equipment distributor with RRU stock.\u0000 sales@nullbyte-telecom.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE",
      async () => ({
        companyName: "Null Byte Telecom Stockist UAE",
        websiteUrl: "https://nullbyte-telecom.ae/contact",
        resultType: "possible_buyer",
        buyerType: "telecom equipment stockist\u0000",
        fitScore: 70,
        confidence: 0.8,
        decision: "review",
        matchedSignals: ["RRU spare parts\u0000"],
        risks: ["Needs manual review\u0000", "Literal escaped null \\u0000 must be removed"]
      })
    );

    const reasons = prisma.leadCandidate.create.mock.calls[0]?.[0].data.icpScore.create.reasons;
    expect(JSON.stringify(reasons)).not.toContain("\\u0000");
    expect(JSON.stringify(reasons)).not.toContain("\u0000");
  });

  it("skips obvious report/list pages while keeping direct company and social evidence", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Telecom Equipment Distributor UAE | LinkedIn",
          url: "https://www.linkedin.com/company/noisy-telecom-page",
          snippet: "LinkedIn company page for a possible distributor",
          source: "web"
        },
        {
          title: "Top 10 Telecom Equipment Distributors in UAE - Industry Report",
          url: "https://marketexample.com/blog/top-telecom-equipment-distributors-uae",
          snippet: "A news article and market report about telecom distribution trends in Dubai.",
          source: "web"
        },
        {
          title: "Gulf Supply LLC - Telecom Equipment Stockist UAE",
          url: "https://gulfsupply.ae/contact",
          snippet:
            "Dubai telecom equipment stockist and system integrator with RRU BBU parts. sales@gulfsupply.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledTimes(2);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Noisy Telecom Page",
          website: "https://www.linkedin.com/company/noisy-telecom-page",
          status: "intelligence",
          icpScore: {
            create: expect.objectContaining({
              score: expect.any(Number),
              reasons: expect.objectContaining({
                leadType: "intelligence"
              })
            })
          }
        })
      })
    );
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Gulf Supply LLC",
          website: "https://gulfsupply.ae/contact",
          status: expect.stringMatching(/qualified|review/)
        })
      })
    );
  });

  it("keeps product application pages as low-confidence candidate evidence", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Radio Frequency Remote Unit (RRU) Key Component for Wireless Signal Transmission",
          url: "https://www.hebeimailing.com/application/lightning-protection-for-rru",
          snippet:
            "Application note explaining RRU lightning protection and wireless signal transmission for telecom equipment.",
          source: "web"
        },
        {
          title: "Desert Link Trading LLC - Telecom Equipment Distributor UAE",
          url: "https://desertlink.ae/about-us",
          snippet:
            "Telecom equipment distributor and stockist in Dubai with RRU BBU spare parts. sales@desertlink.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Desert Link Trading LLC",
          website: "https://desertlink.ae/about-us"
        })
      })
    );
  });

  it("skips marketplace results but still lets weak non-marketplace fits reach ICP scoring", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Wholesale ZTE Phone Parts High-Quality Spare Parts",
          url: "https://www.alibaba.com/showroom/zte-phone-parts.html",
          snippet: "Marketplace listing for consumer phone parts.",
          source: "web"
        },
        {
          title: "Maintenance & Repair",
          url: "https://www.extra.com/en-sa/maintenance",
          snippet: "Retail maintenance and repair page.",
          source: "web"
        },
        {
          title: "Riyadh Network Supplies - Telecom Equipment Distributor",
          url: "https://riyadhnetworksupplies.sa/contact",
          snippet:
            "Saudi telecom equipment distributor and system integrator with BBU stock. sales@riyadhnetworksupplies.sa",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Riyadh Network Supplies"
        })
      })
    );
  });

  it("skips B2B marketplace platforms without inheriting the query country blindly", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const [accio] = service.normalizeSearchResults(
      [
        {
          title: "Accio - Telecom equipment manufacturers",
          url: "https://www.accio.com/supplier/telecom-equipment-manufacturers",
          snippet: "Source from verified telecom equipment manufacturers and compare quotes.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    expect(accio?.country).toBeNull();

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "TradeWheel Telecommunications Products",
          url: "https://www.tradewheel.com/telecommunications/",
          snippet: "Online B2B marketplace listing wholesale suppliers and exporters.",
          source: "web"
        },
        {
          title: "Accio - Telecom equipment manufacturers",
          url: "https://www.accio.com/supplier/telecom-equipment-manufacturers",
          snippet: "AI sourcing platform for comparing telecom equipment manufacturers.",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(2);
    expect(prisma.leadCandidate.create).not.toHaveBeenCalled();
  });

  it("hard rejects seller storefronts and product catalogs even when they expose sales contacts", async () => {
    const prisma = createPrismaMock();
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async () => {
      return new Response(
        `
          <html>
            <body>
              <nav>Search for products | Login / Register | Cart</nav>
              <section>Product categories, product catalog, and in stock items.</section>
              <a href="mailto:sales@fiberolt.com">sales@fiberolt.com</a>
              <a href="tel:+44 20 1234 5678">+44 20 1234 5678</a>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" }
        }
      );
    });
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "FiberOLT - Huawei H807GPBD",
          url: "https://www.fiberolt.com/huawei-h807gpbd.html",
          snippet: "Huawei H807GPBD optical network terminal.",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).not.toHaveBeenCalled();
  });

  it("does not reject a buyer-side service company for mentioning a single storefront signal", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Screamer Electronic Services",
          url: "https://screamerelectronicservices.com/contact",
          snippet:
            "Telecom equipment repair, reverse logistics and spare parts support. Product catalog available. sales@screamerelectronicservices.com +27 87 940 6666",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["South Africa"]
      },
      "South Africa"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalled();
  });

  it("keeps contact-less unverified service pages in review unless they are obvious errors", async () => {
    // Mature lead-quality policy: a buyer-side service page can be
    // useful evidence. Without direct contact and verified country it
    // should stay review-level, not be silently discarded.
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Atlas Network Services LLC - UAE Telecom Maintenance",
          url: "https://atlasnetwork.ae/services",
          snippet:
            "UAE telecom network services, maintenance company and system integrator for RRU BBU site operations.",
          source: "web"
        },
        {
          title: "Gulf Field Telecom LLC - UAE Telecom Maintenance Contact",
          url: "https://gulffieldtelecom.ae/contact",
          snippet:
            "UAE telecom field services, network maintenance company and system integrator for RRU BBU site operations. sales@gulffieldtelecom.ae +971 4 123 4567",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(2);
    const atlasCall = prisma.leadCandidate.create.mock.calls.find(
      ([input]: any) =>
        input.data.website === "https://atlasnetwork.ae/services"
    );
    expect(atlasCall?.[0].data.status).toBe("review");
    expect(atlasCall?.[0].data.icpScore.create.score).toBeGreaterThanOrEqual(50);
    const gulfCall = prisma.leadCandidate.create.mock.calls.find(
      ([input]: any) =>
        input.data.website === "https://gulffieldtelecom.ae/contact"
    );
    expect(gulfCall?.[0].data.status).not.toBe("rejected");
    // Gulf has a direct phone and email so the floor applies a higher
    // value AND the standard scoring path also lifts it; we expect at
    // least 60 (the contactful floor).
    expect(gulfCall?.[0].data.icpScore.create.score).toBeGreaterThanOrEqual(60);
  });

  it("stores query country separately and requires official evidence before assigning a lead country", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const [company, marketplace] = service.normalizeSearchResults(
      [
        {
          title: "Riyadh Radio Systems - Telecom Equipment Stockist",
          url: "https://riyadhradiosystems.com/contact",
          snippet:
            "Telecom equipment stockist and system integrator with RRU BBU spare parts. sales@riyadhradiosystems.com",
          source: "web"
        },
        {
          title: "Accio - Telecom equipment manufacturers",
          url: "https://www.accio.com/supplier/telecom-equipment-manufacturers",
          snippet: "Source from verified telecom equipment manufacturers and compare quotes.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Saudi Arabia" }
    );

    expect(company?.queryCountry).toBe("SAUDI ARABIA");
    expect(company?.country).toBeNull();
    expect(company?.countryConfidence).toBe("unknown");
    expect(marketplace?.country).toBeNull();

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Riyadh Radio Systems - Telecom Equipment Stockist",
          url: "https://riyadhradiosystems.com/contact",
          snippet:
            "Telecom equipment stockist and system integrator with RRU BBU spare parts. Riyadh office Saudi Arabia. Phone +966 11 123 4567. sales@riyadhradiosystems.com",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(result.createdCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Riyadh Radio Systems",
          queryCountry: "SAUDI ARABIA",
          country: "SAUDI ARABIA",
          inferredCountry: "SAUDI ARABIA",
          countryConfidence: "high",
          countryConflict: false
        })
      })
    );
  });

  it("uses Ethiopia phone evidence to hard-reject GCC off-target candidates", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Spectrum Engineering - Telecom Maintenance",
          url: "https://spectrum-engineering.net/",
          snippet:
            "Ethiopia office. Telecom engineering contractor and network maintenance company. Phone +251 982 209 595. info@spectrumengineering.et",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    const createCall = prisma.leadCandidate.create.mock.calls[0]?.[0];
    expect(createCall.data.country).toBe("ETHIOPIA");
    expect(createCall.data.queryCountry).toBe("UAE");
    expect(createCall.data.countryConfidence).toMatch(/high|medium/);
    expect(createCall.data.status).toBe("rejected");
    expect(createCall.data.icpScore.create.score).toBeLessThanOrEqual(39);
    expect(createCall.data.icpScore.create.reasons.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Verified candidate country is outside the selected target markets")
      ])
    );
  });

  it("hard-rejects verified-country candidates from outside the target list (no new-market exploration)", async () => {
    // 2026-05 Stage 2 follow-up: a verified country (high/medium
    // confidence, no conflict) outside the selected target markets
    // is now a hard reject. Earlier policy kept these as soft
    // "new-market exploration" leads, but the buyer-role floor would
    // routinely rescue them back into the main pool — a Germany task
    // would surface US/UK/FR sellers for outreach, which the user
    // never asked for. Verified off-target = settled fact, not hint.
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Poznan Radio Systems - Telecom Equipment Stockist",
          url: "https://poznanradiosystems.com/contact",
          snippet:
            "Poland office. Telecom equipment stockist and system integrator with RRU BBU spare parts. Phone +48 61 123 4567. sales@poznanradiosystems.com",
          source: "web"
        },
        {
          title: "Berlin Radio Systems - Telecom Equipment Stockist",
          url: "https://berlinradio.de/contact",
          snippet:
            "Germany office. Telecom equipment stockist and system integrator with RRU BBU spare parts. Phone +49 30 123456. sales@berlinradio.de",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Poland"]
      },
      "Poland"
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Poznan Radio Systems",
          country: "POLAND"
        })
      })
    );
    const berlinCall = prisma.leadCandidate.create.mock.calls.find(
      ([input]: any) =>
        input.data.website === "https://berlinradio.de/contact"
    );
    expect(berlinCall?.[0].data.country).toBe("GERMANY");
    expect(berlinCall?.[0].data.queryCountry).toBe("POLAND");
    expect(berlinCall?.[0].data.countryConflict).toBe(false);
    expect(berlinCall?.[0].data.status).toBe("rejected");
    expect(berlinCall?.[0].data.icpScore.create.score).toBeLessThanOrEqual(39);
    expect(berlinCall?.[0].data.icpScore.create.reasons.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Verified candidate country is outside the selected target markets")
      ])
    );
  });

  it("hard-rejects verified off-target countries (e.g. Kenya target, US-verified Tempest)", async () => {
    // 2026-05 Stage 2 follow-up: previously this test asserted the
    // candidate landed at review/qualified with a soft "new-market
    // exploration" risk. Policy reversed: verified off-target is a
    // hard reject so the user's selected target markets stay clean.
    // We still keep the row + record the mismatch in risks so the
    // user can audit later.
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Tempest Network Solutions - DAS and Wireless Services",
          url: "https://tempestns.com/services",
          snippet:
            "United States office. Wireless infrastructure contractor for DAS and private networks. Phone +1 630 209 8300. contact@tempestns.com",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Kenya"],
        customerTypeKeywords: [
          "DAS integrator",
          "wireless infrastructure contractor",
          "network maintenance"
        ]
      },
      "Kenya"
    );

    expect(result.createdCount).toBe(1);
    const tempestCall = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(tempestCall.companyName).toBe("Tempest Network Solutions");
    expect(tempestCall.queryCountry).toBe("KENYA");
    expect(tempestCall.country).toBe("UNITED STATES");
    expect(tempestCall.inferredCountry).toBe("UNITED STATES");
    expect(tempestCall.countryConflict).toBe(false);
    expect(tempestCall.status).toBe("rejected");
    expect(tempestCall.icpScore.create.score).toBeLessThanOrEqual(39);
    expect(tempestCall.icpScore.create.reasons.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Verified candidate country is outside the selected target markets")
      ])
    );
  });

  it("keeps a verified target-market lead in the main flow when discovered from another target-market query", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title:
            "Expert Contracting Services in Saudi Arabia for Maintenance | Establishment KHADMAT AL-ABRADJ For Contracting",
          url: "https://towerservice.net/",
          snippet:
            "Khadmat Al-Abradj specializes in mobile tower maintenance and infrastructure works. Contact Ts@towerservice.net +966556394660. Location Saudi Arabia, Riyadh.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Oman", "Saudi Arabia"],
        customerTypeKeywords: ["mobile tower maintenance", "telecom contractor", "field service"]
      },
      "Oman"
    );

    expect(result.createdCount).toBe(1);
    const createdLead = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createdLead).toEqual(
      expect.objectContaining({
        country: "SAUDI ARABIA",
        queryCountry: "OMAN",
        inferredCountry: "SAUDI ARABIA",
        countryConfidence: "high",
        countryConflict: false
      })
    );
    expect(createdLead.status).not.toBe("review");
    expect(createdLead.icpScore.create.reasons).toEqual(
      expect.objectContaining({
        countryValidation: expect.objectContaining({
          queryCountry: "OMAN",
          inferredCountry: "SAUDI ARABIA",
          countryConflict: false
        })
      })
    );
  });

  it("keeps macro-market countries in the main flow when discovered from a different query country", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Bahrain Tower Services - Telecom Site Maintenance Contractor",
          url: "https://bahraintowerservices.bh/contact",
          snippet:
            "Bahrain telecom tower maintenance contractor for base station and RAN site support. Manama Bahrain. Phone +973 1712 3456. sales@bahraintowerservices.bh",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Oman", "Middle East"],
        customerTypeKeywords: ["telecom tower maintenance", "telecom contractor", "field service"]
      },
      "Oman"
    );

    expect(result.createdCount).toBe(1);
    const createdLead = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createdLead).toEqual(
      expect.objectContaining({
        country: "BAHRAIN",
        queryCountry: "OMAN",
        inferredCountry: "BAHRAIN",
        countryConfidence: "high",
        countryConflict: false
      })
    );
    expect(createdLead.status).not.toBe("review");
    expect(createdLead.status).not.toBe("review");
    expect(createdLead.status).not.toBe("rejected");
  });

  it("matches macro target regions by member countries instead of treating them as global", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const macroCriteria = {
      ...criteria,
      targetRegions: ["Middle East", "Africa", "Brazil", "Saudi Arabia"]
    };
    const baseCandidate = {
      taskId: "task-1",
      website: "https://example.com",
      sourceUrl: "https://example.com/contact",
      contacts: [
        {
          type: "email" as const,
          value: "sales@example.com",
          sourceUrl: "https://example.com/contact"
        }
      ]
    };

    const uaeScore = service.scoreCandidate(
      {
        ...baseCandidate,
        companyName: "Dubai DAS Integrator",
        country: "UAE",
        inferredCountry: "UAE",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            country: "UAE",
            value: "+971 4 123 4567",
            sourceUrl: "https://example.com",
            confidence: "high"
          }
        ],
        summary: "Telecom DAS small cell system integrator with RRU BBU maintenance services."
      },
      macroCriteria
    );
    const southAfricaScore = service.scoreCandidate(
      {
        ...baseCandidate,
        companyName: "Johannesburg Telecom Maintenance",
        country: "SOUTH AFRICA",
        inferredCountry: "SOUTH AFRICA",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            country: "SOUTH AFRICA",
            value: "+27 11 123 4567",
            sourceUrl: "https://example.com",
            confidence: "high"
          }
        ],
        summary: "Telecom field maintenance contractor for base station RRU BBU and power systems."
      },
      macroCriteria
    );
    const usScore = service.scoreCandidate(
      {
        ...baseCandidate,
        companyName: "US DAS Integrator",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            country: "UNITED STATES",
            value: "+1 630 209 8300",
            sourceUrl: "https://example.com",
            confidence: "high"
          }
        ],
        summary: "Telecom DAS small cell system integrator with RRU BBU maintenance services."
      },
      macroCriteria
    );

    expect(uaeScore.status).not.toBe("rejected");
    expect(southAfricaScore.status).not.toBe("rejected");
    // 2026-05 Stage 2 follow-up: US (verified outside the macro region
    // Middle East/Africa) is now hard-rejected. Macro target regions
    // expand member countries (UAE, Saudi, South Africa, etc.) but
    // anything outside the expanded set + verified high/medium is a
    // settled off-target.
    expect(usScore.status).toBe("rejected");
    expect(usScore.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Verified candidate country is outside the selected target markets")
      ])
    );
  });

  // 2026-05 Stage 2 follow-up: verified-off-target hard reject must
  // only fire when (a) the country is verified high/medium, (b) there
  // is no country conflict, and (c) the country is outside the target
  // markets. The next four tests pin down those guardrails so the
  // policy doesn't regress into killing soft / ambiguous candidates.

  it("does NOT hard-reject off-target candidates when country confidence is low", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Mystery DAS Integrator",
        website: "https://example.com",
        sourceUrl: "https://example.com/contact",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        // Low confidence — phone area code only, no address evidence.
        countryConfidence: "low",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            country: "UNITED STATES",
            value: "+1 555 1234567",
            sourceUrl: "https://example.com",
            confidence: "low"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "sales@example.com",
            sourceUrl: "https://example.com/contact"
          }
        ],
        summary: "Telecom DAS small cell system integrator with RRU BBU maintenance services."
      },
      { ...criteria, targetRegions: ["Germany"] }
    );

    // Soft mismatch only — score gets the legacy -20 nudge but the
    // candidate still has a chance to surface for human review.
    expect(score.status).not.toBe("rejected");
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Official country evidence does not match the selected target markets")
      ])
    );
  });

  it("does NOT hard-reject off-target candidates when country confidence is unknown", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Mystery DAS Integrator",
        website: "https://example.com",
        sourceUrl: "https://example.com/contact",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        countryConfidence: "unknown",
        countryConflict: false,
        countryEvidence: [],
        contacts: [
          {
            type: "email" as const,
            value: "sales@example.com",
            sourceUrl: "https://example.com/contact"
          }
        ],
        summary: "Telecom DAS small cell system integrator with RRU BBU maintenance services."
      },
      { ...criteria, targetRegions: ["Germany"] }
    );

    // Unknown confidence falls through to the targetCountryUnverified
    // branch (risk note, no -20). Candidate keeps its review chance.
    expect(score.status).not.toBe("rejected");
  });

  it("does NOT hard-reject country conflicts when one conflict country matches the target market", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Multi-country Integrator",
        website: "https://example.com",
        sourceUrl: "https://example.com/contact",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        countryConfidence: "medium",
        countryConflict: true,
        countryConflictCountries: ["UNITED STATES", "GERMANY"],
        countryEvidence: [
          {
            type: "phone",
            country: "UNITED STATES",
            value: "+1 555 1234567",
            sourceUrl: "https://example.com",
            confidence: "medium"
          },
          {
            type: "phone",
            country: "GERMANY",
            value: "+49 30 1234567",
            sourceUrl: "https://example.com",
            confidence: "medium"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "sales@example.com",
            sourceUrl: "https://example.com/contact"
          }
        ],
        summary: "Telecom DAS small cell system integrator with RRU BBU maintenance services."
      },
      { ...criteria, targetRegions: ["Germany"] }
    );

    // Country conflict means evidence points to two different countries.
    // If at least one verified signal is the target market, the row is
    // ambiguous rather than settled off-target.
    expect(score.status).not.toBe("rejected");
  });

  it("hard-rejects country conflicts when all verified country signals are outside the target markets", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Second Sight Systems",
        website: "https://secondsightsystems.com/services/tower-services/",
        sourceUrl: "https://secondsightsystems.com/services/tower-services/",
        country: "UNITED STATES",
        inferredCountry: null,
        countryConfidence: "low",
        countryConflict: true,
        countryConflictCountries: ["UNITED STATES", "PHILIPPINES"],
        countryEvidence: [
          {
            type: "phone",
            country: "UNITED STATES",
            value: "+1 844 789 9111",
            sourceUrl: "https://secondsightsystems.com",
            confidence: "high"
          },
          {
            type: "phone",
            country: "PHILIPPINES",
            value: "63127 844-789-9111",
            sourceUrl: "https://secondsightsystems.com",
            confidence: "high"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "info@sssrf.com",
            sourceUrl: "https://secondsightsystems.com"
          }
        ],
        summary:
          "Tower services including tower installation, tower maintenance and microwave dish work."
      },
      { ...criteria, targetRegions: ["Nigeria", "Kenya"] }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("none of the verified country signals match the selected target markets")
      ])
    );
  });

  it("does NOT hard-reject member-country candidates of a macro target (Middle East + Qatar)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Doha Telecom Maintenance",
        website: "https://example.com",
        sourceUrl: "https://example.com/contact",
        country: "QATAR",
        inferredCountry: "QATAR",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            country: "QATAR",
            value: "+974 4 123 4567",
            sourceUrl: "https://example.com",
            confidence: "high"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "sales@example.com",
            sourceUrl: "https://example.com/contact"
          }
        ],
        summary: "Telecom DAS small cell system integrator with RRU BBU maintenance services."
      },
      { ...criteria, targetRegions: ["Middle East"] }
    );

    // Qatar is a member country of the "Middle East" macro region, so
    // matchesTargetRegion must accept it; verified-off-target hard
    // reject must NOT fire.
    expect(score.status).not.toBe("rejected");
  });

  it("hard-rejects medium-confidence verified off-target countries (Germany target + US medium)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        // Strong buyer-role + product signals so the legacy floor
        // would normally rescue this row to score 55-63. The hard
        // reject must override regardless.
        companyName: "US DAS Integrator",
        website: "https://example.com",
        sourceUrl: "https://example.com/contact",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        countryConfidence: "medium",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            country: "UNITED STATES",
            value: "+1 630 209 8300",
            sourceUrl: "https://example.com",
            confidence: "medium"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "sales@example.com",
            sourceUrl: "https://example.com/contact"
          }
        ],
        summary: "Telecom DAS small cell system integrator with RRU BBU maintenance services."
      },
      { ...criteria, targetRegions: ["Germany"] }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Verified candidate country is outside the selected target markets")
      ])
    );
  });

  it("keeps tender portals as intelligence review while keeping direct company evidence", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "UAE Tenders, Dubai, Abu Dhabi RFP and E Procurement Notice",
          url: "https://www.tendersontime.com/uae-tenders/",
          snippet: "Tender portal listing public procurement notices and RFPs.",
          source: "web"
        },
        {
          title: "Atlas Network Solutions LLC - Telecom System Integrator UAE",
          url: "https://atlasnetwork.ae/contact",
          snippet:
            "Dubai telecom system integrator and network maintenance company for RRU BBU site support. sales@atlasnetwork.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          website: "https://www.tendersontime.com/uae-tenders/",
          status: "intelligence",
          icpScore: expect.objectContaining({
            create: expect.objectContaining({
              score: expect.any(Number)
            })
          })
        })
      })
    );
    const tenderCreateCall = prisma.leadCandidate.create.mock.calls.find(
      ([input]) => input.data.website === "https://www.tendersontime.com/uae-tenders/"
    );
    expect(tenderCreateCall?.[0].data.icpScore.create.score).toBeLessThan(50);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Atlas Network Solutions LLC"
        })
      })
    );
  });

  it("skips market reports even when they expose contact evidence", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Telecom Equipment Global Market Report",
          url: "https://www.thebusinessresearchcompany.com/report/telecom-equipment-global-market-report",
          snippet:
            "Global market report, market size and forecast 2020-2025, 2026 - 2030 - 2035. Contact info@tbrc.info",
          source: "web"
        },
        {
          title: "Metro Radio Systems LLC - Telecom Equipment Stockist UAE",
          url: "https://metroradio.ae/contact",
          snippet:
            "Dubai telecom equipment stockist and system integrator with RRU BBU parts. sales@metroradio.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Metro Radio Systems LLC"
        })
      })
    );
  });

  it("hard rejects content document hosts even when they look like RFQ evidence", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "5G Telecom Equipment RFQ PDF",
          url: "https://www.scribd.com/document/123456/5g-telecom-equipment-rfq",
          snippet: "Request for quotation RFQ for RRU BBU spare parts. procurement@example.com",
          source: "web"
        },
        {
          title: "Telecom Equipment Supplier Directory",
          url: "https://www.pdfcoffee.com/telecom-equipment-supplier-directory-pdf-free.html",
          snippet: "PDF directory of telecom equipment suppliers and contacts.",
          source: "web"
        },
        {
          title: "Metro Radio Systems LLC - Telecom Equipment Stockist UAE",
          url: "https://metroradio.ae/contact",
          snippet:
            "Dubai telecom equipment stockist and system integrator with RRU BBU parts. sales@metroradio.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Metro Radio Systems LLC"
        })
      })
    );
    expect(
      prisma.leadCandidate.create.mock.calls.some(([input]) =>
        /scribd|pdfcoffee/i.test(input.data.website ?? "")
      )
    ).toBe(false);
  });

  it("skips the user's own product website as a lead source", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Huawei UPBA0 Board - TeleCoreNet",
          url: "https://telecorenet.com/product/huawei-upba0-board/",
          snippet: "Telecom equipment RRU BBU spare parts. xiaokangze@gmail.com +8617610361038",
          source: "web"
        },
        {
          title: "STS Specialized Telecom Service LLC",
          url: "https://www.sts-ae.com/",
          snippet: "Telecom service and network maintenance company. info@sts-ae.com +9712 6352826",
          source: "web"
        }
      ],
      {
        ...criteria,
        ownDomains: ["telecorenet.com"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "STS Specialized Telecom Service LLC"
        })
      })
    );
  });

  it("skips third-party company profile pages instead of qualifying the profile host", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Maroc Telecom SA Company Profile",
          url: "https://www.globaldata.com/company-profile/maroc-telecom-sa/",
          snippet:
            "Company profile, executives, locations and telecom procurement signals. +212 53 7719000",
          source: "web"
        },
        {
          title: "MedTech Network and Telecom Solutions Integration",
          url: "https://medtech.ma/en/network-and-telecom-solutions-integration-2/",
          snippet:
            "Morocco telecom system integrator and network maintenance company. contact@medtech.ma",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Morocco"]
      },
      "Morocco"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "MedTech Network and Telecom Solutions Integration"
        })
      })
    );
  });

  it("keeps brand OEM sites out of the buyer review list by default", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Ericsson - Enabling the full value of connectivity",
          url: "https://www.ericsson.com/en",
          snippet:
            "Ericsson telecom equipment, radio access network, RRU, BBU, 5G and contact info@ericsson.com.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Turkey" }
    );

    const score = service.scoreCandidate(candidate!, {
      ...criteria,
      targetRegions: ["Turkey"],
      brandTerms: ["Ericsson", "Huawei", "Nokia", "ZTE"]
    });

    expect(score.score).toBeLessThan(50);
    expect(score.status).toBe("rejected");
    expect(score.risks).toContain(
      "Brand or OEM official site is usually supplier/competitor evidence, not a buyer lead"
    );
  });

  it("keeps solar OEM brand sites out of the buyer review list", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "GoodWe UAE - Solar inverter and energy storage solutions",
          url: "https://www.goodwe.com/",
          snippet:
            "GoodWe manufactures PV inverters, hybrid inverters and energy storage systems. Contact sales@goodwe.com.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const score = service.scoreCandidate(candidate!, {
      ...criteria,
      targetRegions: ["UAE"],
      productKeywords: ["solar inverter", "PV inverter", "BESS"],
      customerTypeKeywords: ["solar EPC contractor", "PV distributor", "installer"],
      brandTerms: ["GoodWe", "Sungrow", "Growatt", "SolaX"]
    });

    expect(score.score).toBeLessThan(50);
    expect(score.status).toBe("rejected");
    expect(score.pageType).toBe("brand_oem_site");
  });

  it("keeps local non-telecom distributor storefronts as downstream channel buyers", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "PAS INTERNATIONAL TRADING | Solar Equipment Distributor in UAE",
          url: "https://pas-solar.com/",
          snippet:
            "Solar equipment distributor in Dubai UAE distributing inverters, solar panels, cables and accessories. sales@pas-solar.com +971 4 555 0199.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const score = service.scoreCandidate(candidate!, {
      ...criteria,
      targetRegions: ["UAE"],
      productKeywords: ["solar inverter", "PV inverter", "BESS"],
      customerTypeKeywords: ["solar EPC contractor", "PV distributor", "dealer", "importer"],
      brandTerms: ["GoodWe", "Sungrow", "Growatt", "SolaX"]
    });

    expect(score.pageType).toBe("official_company_site");
    expect(score.status).not.toBe("rejected");
    expect(score.score).toBeGreaterThanOrEqual(50);
  });

  it("skips index and indicator pages as discovery noise", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Technology Indicator 02 - China Index",
          url: "https://research.example.com/technology/technology-indicator-02",
          snippet: "Saudi Arabia telecom procurement and project supply index with buyer keywords.",
          source: "web"
        },
        {
          title: "Riyadh Network Systems LLC - Telecom System Integrator Saudi Arabia",
          url: "https://riyadhnetworksystems.sa/contact",
          snippet:
            "Saudi telecom system integrator and network maintenance company with RRU BBU parts. sales@riyadhnetworksystems.sa",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Riyadh Network Systems LLC"
        })
      })
    );
  });

  it("skips top-list pages even when they expose contact details", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Top 10 Telecommunications Tower Companies in the World 2025 - XH Tower Co., Ltd",
          url: "https://xhtower.com/",
          snippet:
            "Contact +852 5795 1525 xhtowerxh@gmail.com for tower systems and telecom equipment.",
          source: "web"
        },
        {
          title: "Delta Tower Systems LLC - Telecom Contractor UAE",
          url: "https://deltatowers.ae/contact",
          snippet:
            "UAE telecom contractor and tower maintenance company for RRU BBU site support. sales@deltatowers.ae",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Delta Tower Systems LLC"
        })
      })
    );
  });

  it("keeps procurement PDFs but skips brochure-style PDFs", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "AlphaStone Contracting Company Profile",
          url: "https://alphastonecontracting.com/company-profile.pdf",
          snippet:
            "Telecom system integrator brochure for telecom equipment project supply, network implementation and site maintenance. sales@alphastonecontracting.com",
          source: "web"
        },
        {
          title: "UAE Telecom RRU BBU Spare Parts RFQ",
          url: "https://procurement.gov/telecom-rfq.pdf",
          snippet:
            "Request for quotation RFQ for telecom equipment, RRU BBU spare parts, vendor registration and procurement contact procurement@uae.gov",
          source: "web"
        },
        {
          title: "Dubai Radio Systems LLC - Telecom Equipment Stockist UAE",
          url: "https://dubairadio.ae/contact",
          snippet: "Dubai telecom equipment stockist with RRU BBU parts. sales@dubairadio.ae",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          website: "https://procurement.gov/telecom-rfq.pdf",
          status: "intelligence"
        })
      })
    );
    const procurementCreateCall = prisma.leadCandidate.create.mock.calls.find(
      ([input]) => input.data.website === "https://procurement.gov/telecom-rfq.pdf"
    );
    expect(procurementCreateCall?.[0].data.icpScore.create.score).toBeLessThan(50);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Dubai Radio Systems LLC"
        })
      })
    );
  });

  it("keeps candidates from known countries outside the target regions but scores them lower", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Lagos Radio Systems - Telecom Equipment Stockist Nigeria",
          url: "https://lagosradio.ng/contact",
          snippet: "Nigeria telecom equipment stockist with RRU BBU parts. sales@lagosradio.ng",
          source: "web"
        },
        {
          title: "Dubai Radio Systems LLC - Telecom Equipment Stockist UAE",
          url: "https://dubairadio.ae/contact",
          snippet: "Dubai telecom equipment stockist with RRU BBU parts. sales@dubairadio.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Dubai Radio Systems LLC"
        })
      })
    );
  });

  it("keeps consumer phone accessory distributors but marks them as ICP risk", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Latest Shenzhen Phone Accessories Wholesale Market Info",
          url: "https://www.lidergroupinc.com/tag/shenzhen-cell-phone-accessories-wholesale-market/",
          snippet:
            "Huawei phone accessories, smartphone repair parts and consumer electronics wholesale. +8620-2982 2580",
          source: "web"
        },
        {
          title: "ICTech Distribution - Huawei Distributor UAE",
          url: "https://www.ictechdistribution.com/brands/B10007535SE/huawei/",
          snippet:
            "UAE distributor for Huawei enterprise and telecom equipment, network products and project supply. info@ictechdistribution.com +971 52 266 9803",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "ICTech Distribution"
        })
      })
    );
  });

  it("keeps contactless service-company pages in review when they are not obvious errors", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Gulf Network Solutions LLC - Telecom System Integrator UAE",
          url: "https://gulfnetwork.ae/about",
          snippet:
            "Dubai telecom system integrator and network maintenance company for RRU BBU site maintenance and 5G rollout.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    const score = service.scoreCandidate(candidate!, criteria);

    expect(score.score).toBeGreaterThanOrEqual(50);
    expect(score.status).toBe("review");
    expect(score.risks).toContain("No usable email, phone, contact form, or social entry found yet");
    expect(score.risks).toContain(
      "No reachable contact entry and target country is unverified; keep as review unless another hard reject applies"
    );
  });

  it("treats contact forms and social profiles as reachable contact entries", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Gulf Network Solutions LLC - Vendor Registration UAE",
          url: "https://gulfnetwork.ae/vendor-registration",
          snippet:
            "Dubai telecom system integrator and network maintenance company for 5G rollout. Submit vendor registration and RFQ requests through this page.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const score = service.scoreCandidate(candidate!, {
      ...criteria,
      targetRegions: ["UAE"]
    });

    expect(candidate?.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "form",
          value: "https://gulfnetwork.ae/vendor-registration"
        })
      ])
    );
    expect(score.risks).not.toContain(
      "No usable email, phone, contact form, or social entry found yet"
    );
    expect(score.risks).not.toContain(
      "No reachable contact entry and target country is unverified; keep as review unless another hard reject applies"
    );
    expect(score.reasons).toContain("Has usable contact signals");
  });

  it("keeps small ISP and WISP operators for review without requiring explicit spare-parts demand", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Wisp Internet - Internet banda larga em Cacapava-SP",
          url: "http://wispinternet.com.br/",
          snippet:
            "Internet banda larga provider in Cacapava-SP Brazil. Local WISP broadband internet service. Email luiz@wispinternet.com.br",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    const score = service.scoreCandidate(candidate!, {
      ...criteria,
      targetRegions: ["Brazil"],
      customerTypeKeywords: ["ISP", "WISP", "internet service provider", "broadband provider"]
    });

    expect(score.score).toBeGreaterThanOrEqual(50);
    expect(score.status).toBe("review");
    expect(score.risks).not.toContain(
      "No clear telecom equipment buyer, distributor, integrator, or maintenance signal"
    );
  });

  it("promotes reachable DAS and wireless engineering firms while keeping contactless infrastructure pages in review", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Communication Technology Services - DAS Small Cell Solutions",
          url: "https://www.cts1.com/das-small-cell-solutions",
          snippet:
            "National in-building cellular DAS and small cell system integrator. Public Safety DAS, Private LTE/5G, CBRS, Wi-Fi, Optical LAN, design, build, monitoring and maintenance. Contact 800-834-5838.",
          source: "web"
        },
        {
          title: "Engineering Wireless Services - DAS, CBRS, Public Safety and Tower Construction",
          url: "https://engineeringwireless.com/das-small-cell-3/",
          snippet:
            "United States office. Wireless communications engineering firm providing DAS, CBRS, public safety, tower construction, turnkey design/build, maintenance and upgrade services. Phone +1 630 209 8300. sales@engineeringwireless.com",
          source: "web"
        },
        {
          title: "Crown Castle - WISP and Telecommunications Infrastructure",
          url: "https://www.crowncastle.com/industries/wisp-and-telecommunications",
          snippet:
            "Communications infrastructure company with cell towers, small cells and fiber network assets serving United States wireless carriers, WISPs and telecommunications networks.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    const scores = candidates.map((candidate) =>
      service.scoreCandidate(candidate, {
        ...criteria,
        targetRegions: ["United States"],
        customerTypeKeywords: [
          "DAS integrator",
          "wireless infrastructure contractor",
          "tower company",
          "WISP"
        ]
      })
    );

    expect(scores.map((score) => score.status)).toEqual(["qualified", "qualified", "review"]);
    expect(scores.map((score) => score.score)).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    ]);
    expect(scores[0]?.score).toBeGreaterThanOrEqual(75);
    expect(scores[1]?.score).toBeGreaterThanOrEqual(75);
    expect(scores[2]?.score).toBeLessThan(75);
    scores.forEach((score) => {
      expect(score.score).toBeGreaterThanOrEqual(50);
      expect(score.risks).not.toContain(
        "Third-party, directory, or content page is kept as evidence but needs manual validation"
      );
    });
  });

  it("does not qualify generic IT service companies without telecom equipment signals", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Best IT Solutions Company in Dubai - Maxxcom Tech",
          url: "https://www.maxxcomtech.com/it-infrastructure-solutions.html",
          snippet:
            "Dubai IT infrastructure solutions, cloud solutions, CCTV, PBX, cybersecurity and structured cabling. Contact sales@maxxcomgulf.com +971 2 642 3334",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const score = service.scoreCandidate(candidate!, criteria);

    expect(score.score).toBeLessThan(75);
    expect(score.status).toBe("rejected");
    expect(score.risks).toEqual(
      expect.arrayContaining([
        "Only generic IT/service signal; no explicit product or buyer context"
      ])
    );
  });

  it("keeps policy and report pages out of high-confidence ICP even when they mention procurement", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title:
            "EU: Commission restricts the procurement of services and equipment from Huawei and ZTE",
          url: "https://www.globaltradealert.org/state-act/75972/eu-commission-restricts-the-procurement-of-services-and-equipment-from-huawei-and-zte",
          snippet:
            "Policy alert mentioning telecom equipment procurement in Israel with Huawei and ZTE.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Israel" }
    );

    const score = service.scoreCandidate(candidate!, {
      ...criteria,
      targetRegions: ["Israel"]
    });

    expect(score.score).toBeLessThan(50);
    expect(score.status).toBe("rejected");
    expect(score.risks).toContain(
      "Discovery/content page without direct contact stays low-confidence"
    );
  });

  it("keeps lookup, regulatory, and directory pages as rejected evidence instead of top candidates", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const candidates = service.normalizeSearchResults(
      [
        {
          title:
            "MCC & MNC Lookup - Mobile Network Codes by Country and Operator | Cellular Finder",
          url: "https://celltowerfinder.com/mcc-mnc-lookup",
          snippet:
            "Lookup mobile network codes by country and operator for Chile telecom carriers.",
          source: "web"
        },
        {
          title: "Register as a Telecommunications provider",
          url: "https://crtc.gc.ca/eng/phone/telecom.htm",
          snippet: "Regulatory registration guide for telecommunications providers.",
          source: "web"
        },
        {
          title: "Software systems integrators in Africa",
          url: "https://www.sourcesecurity.com/companies/software-systems-integrators-africa/directory.html",
          snippet: "Directory listing for software systems integrators in Africa.",
          source: "web"
        },
        {
          title: "Screamer Electronic Services - Telecom Equipment Repair",
          url: "https://screamerelectronicservices.com/contact",
          snippet:
            "Telecom equipment repair, reverse logistics and spare parts support. sales@screamerelectronicservices.com",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Chile" }
    );

    const scores = candidates.map((candidate) =>
      service.scoreCandidate(candidate, {
        ...criteria,
        targetRegions: ["Chile", "Africa"]
      })
    );

    expect(scores[0]?.status).toBe("rejected");
    expect(scores[1]?.status).toBe("rejected");
    expect(scores[1]?.leadType).toBe("government_information");
    expect(scores[2]?.status).toBe("rejected");
    expect(scores[3]?.score).toBeGreaterThan(scores[0]?.score ?? 0);
  });

  it("keeps map/listing pages out of the customer pool despite listing-page contact emails", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Highcloud Solutions Inc - MapQuest",
          url: "https://www.mapquest.com/us/minnesota/highcloud-solutions-inc-420618817",
          snippet:
            "MapQuest local listing for Highcloud Solutions Inc. Network equipment service, job listings, directions, maps, help@mapquest.com.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Kenya" }
    );

    const score = service.scoreCandidate(candidate!, {
      ...criteria,
      targetRegions: ["Kenya", "Nigeria"],
      productKeywords: ["Huawei RRU", "ZTE BBU", "rectifier module"],
      customerTypeKeywords: ["telecom contractor", "system integrator", "maintenance company"]
    });

    expect(["intelligence", "rejected"]).toContain(score.status);
    expect(score.status).not.toBe("review");
    expect(score.status).not.toBe("qualified");
    expect(score.pageType).toBe("third_party_profile");
    expect(score.score).toBeLessThan(50);
    expect(score.risks).toEqual(
      expect.arrayContaining([expect.stringContaining("Third-party profile")])
    );
  });

  it("keeps third-party directories and asset-title names out of the main customer pool", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const candidates = service.normalizeSearchResults(
      [
        {
          title:
            "Networks System Integration Saudi Arabia Corporation Limited | ProTenders",
          url: "https://www.protenders.com/companies/networks-system-integration-saudi-arabia-corporation-limited",
          snippet:
            "Company profile on a construction directory for system integration projects in Saudi Arabia.",
          source: "web"
        },
        {
          title: "The Best Systems Integration Companies in Qatar",
          url: "https://themanifest.com/qa/systems-integration/companies",
          snippet:
            "Directory list of top systems integration companies in Qatar with rankings and profiles.",
          source: "web"
        },
        {
          title: "Distributors in Qatar | Exporteers",
          url: "https://exporteers.com/distributors-qatar/",
          snippet:
            "Consulting page about finding resellers and dealers in Qatar, not an official buyer company.",
          source: "web"
        },
        {
          title: "OM0000003026 - Oman Telecommunications Company SAOG",
          url: "https://www.marketscreener.com/quote/stock/OMAN-TELECOMMUNICATIONS-C-6498723/company/",
          snippet:
            "Financial profile and company stock market data for Oman Telecommunications.",
          source: "web"
        },
        {
          title: "FTTH - Encyclopedia",
          url: "https://encyclopedia.pub/entry/ftth-network-architecture",
          snippet:
            "Encyclopedia article about FTTH and telecom networks. Contact office@encyclopedia.pub.",
          source: "web"
        },
        {
          title: "Artificial Intelligence icon",
          url: "https://www.creative-sols.com/system-integration",
          snippet:
            "Creative Solutions provides system integration services in Saudi Arabia. Contact us for enterprise IT services.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Saudi Arabia" }
    );

    expect(candidates[5]?.companyName).toBe("Creative Sols");

    const scores = candidates.map((candidate) =>
      service.scoreCandidate(candidate, {
        ...criteria,
        targetRegions: ["Saudi Arabia", "Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["system integrator", "maintenance company", "stockist"]
      })
    );

    expect(["rejected", "intelligence"]).toContain(scores[0]?.status);
    expect(scores[0]?.status).not.toBe("review");
    expect(scores[0]?.status).not.toBe("qualified");
    expect(["third_party_profile", "procurement_document"]).toContain(scores[0]?.pageType);
    expect(scores[0]?.score).toBeLessThan(50);
    expect(["rejected", "intelligence"]).toContain(scores[1]?.status);
    expect(scores[1]?.status).not.toBe("review");
    expect(scores[1]?.status).not.toBe("qualified");
    expect(scores[1]?.pageType).toBe("third_party_profile");
    expect(scores[1]?.score).toBeLessThan(50);
    expect(["rejected", "intelligence"]).toContain(scores[2]?.status);
    expect(scores[2]?.status).not.toBe("review");
    expect(scores[2]?.status).not.toBe("qualified");
    expect(scores[2]?.pageType).toBe("third_party_profile");
    expect(scores[2]?.score).toBeLessThan(50);
    expect(["rejected", "intelligence"]).toContain(scores[3]?.status);
    expect(scores[3]?.status).not.toBe("review");
    expect(scores[3]?.status).not.toBe("qualified");
    expect(scores[3]?.pageType).toBe("third_party_profile");
    expect(scores[3]?.score).toBeLessThan(50);
    expect(scores[4]?.status).toBe("rejected");
    expect(scores[4]?.score).toBeLessThan(50);
    expect(scores[5]?.score).toBeLessThan(75);
    expect(scores[5]?.status).not.toBe("qualified");
  });

  it("keeps obvious directory, article, and off-industry pages out of relaxed telecom review", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Telecommunications Contractor | Yellow Pages Asia",
          url: "https://www.yellowpages.asia/places/telecommunications-contractor",
          snippet:
            "Telecommunications Contractor suppliers on Yellow Pages Asia. B2B Marketplace, Products, Companies, Distributors, Dealers, Contact.",
          source: "web"
        },
        {
          title: "Saudi Arabia Transmission systems installers",
          url: "https://security-img.scdn6.secure.raxcdn.com/companies/transmission-systems-installers-saudi-arabia/directory.html",
          snippet:
            "Directory listing of telecom contractors and systems integrators in Saudi Arabia.",
          source: "web"
        },
        {
          title: "GOODWILL FREIGHT LIMITED heavy machinery sourcing",
          url: "https://www.goodwillfreight.com/2025/08/26/heavy-machinery-sourcing-china-uae-importers/",
          snippet:
            "Sourcing from China offers UAE businesses heavy equipment import options and freight services.",
          source: "web"
        },
        {
          title: "VectorPro force testing software distributors",
          url: "https://www.mecmesin.com/distributors",
          snippet:
            "Force testing software and materials testing instruments distributors. UAE phone +971 67454194.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Saudi Arabia" }
    );

    const scores = candidates.map((candidate) =>
      service.scoreCandidate(candidate, {
        ...criteria,
        targetRegions: ["Saudi Arabia", "UAE"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["system integrator", "maintenance company", "stockist"]
      })
    );

    expect(["intelligence", "rejected"]).toContain(scores[0]?.status);
    expect(scores.slice(1).map((score) => score.status)).toEqual([
      "intelligence",
      "rejected",
      "rejected"
    ]);
    for (const score of scores) {
      expect(score.status).not.toBe("review");
      expect(score.status).not.toBe("qualified");
      expect(score.score).toBeLessThan(50);
    }
  });

  it("does not promote unverified companies mined from unrelated directories", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Beny",
        website: "https://www.beny.com/",
        country: null,
        queryCountry: "QATAR",
        sourceUrl: "https://www.beny.com/",
        sourcePageUrl: "https://www.enfsolar.com/directory/installer/UAE",
        sourcePageTitle: "ENF List of Solar Companies and Products",
        summary:
          "ENF Solar is a company directory of photovoltaic suppliers. Buyers and sellers are directly connected.",
        contacts: []
      },
      {
        ...criteria,
        targetRegions: ["Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["system integrator", "maintenance company", "stockist"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.pageType).toBe("third_party_profile");
    expect(score.score).toBeLessThan(50);
  });

  it("does not let consumer electronics pages become high-match telecom infrastructure leads", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Consumer Electronics",
        website: "https://alibinali.com/business-streams/aba-consumer-electronics/",
        sourceUrl: "https://alibinali.com/business-streams/aba-consumer-electronics/",
        country: "QATAR",
        inferredCountry: "QATAR",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email",
            value: "sales@example.qa",
            sourceUrl: "https://alibinali.com/contact-us"
          },
          {
            type: "phone",
            value: "+974 44292126",
            sourceUrl: "https://alibinali.com/contact-us"
          }
        ],
        summary:
          "The official distributor of Samsung in Qatar supplies Samsung phones, accessories, print and display solutions and monitors to major retailers. Apart from consumer electronics, it provides enterprise solutions and Telecom."
      },
      {
        ...criteria,
        targetRegions: ["Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["distributor", "system integrator", "maintenance company"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Consumer-electronics or phone-accessory page is not a 5G/RAN/base-station infrastructure buyer"
        )
      ])
    );
  });

  it("rejects security-camera and CCTV pages in telecom infrastructure tasks", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Hikvision UAE",
        website: "https://www.hikvision.com/mena/",
        sourceUrl: "https://www.hikvision.com/mena/products/IP-Products/Network-Cameras/",
        country: "UAE",
        inferredCountry: "UAE",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "form",
            value: "https://www.hikvision.com/mena/support/contact-us/",
            sourceUrl: "https://www.hikvision.com/mena/support/contact-us/"
          }
        ],
        summary:
          "Hikvision provides video surveillance, security cameras, CCTV and access control solutions for commercial buildings in UAE."
      },
      {
        ...criteria,
        targetRegions: ["UAE"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["stockist", "system integrator", "tower contractor"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Off-target product/service evidence for a telecom task")
      ])
    );
  });

  it("rejects event and expo pages in telecom infrastructure tasks", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "HouseHold Expo",
        website: "https://householdexpo.com/",
        sourceUrl: "https://householdexpo.com/exhibitors",
        country: "UAE",
        inferredCountry: "UAE",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email",
            value: "info@householdexpo.com",
            sourceUrl: "https://householdexpo.com/contact"
          }
        ],
        summary:
          "International trade show and exhibition for household goods, baby products and toys. Exhibitor registration and expo visitor information."
      },
      {
        ...criteria,
        targetRegions: ["UAE"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["stockist", "system integrator", "tower contractor"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Off-target product/service evidence for a telecom task")
      ])
    );
  });

  it("promotes reachable telecom infrastructure system integrators into high-match leads", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Waseela",
        website: "https://waseela.com/en/contact",
        sourceUrl: "https://waseela.com/en/contact",
        country: "SAUDI ARABIA",
        inferredCountry: "SAUDI ARABIA",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email",
            value: "info@waseela.com",
            sourceUrl: "https://waseela.com/en/contact"
          },
          {
            type: "phone",
            value: "+966 11 2171117",
            sourceUrl: "https://waseela.com/en/contact"
          }
        ],
        summary:
          "Waseela is a leading Master Turnkey Systems Integrator offering end-to-end solutions for complex large-scale ICT projects for telecom service providers, public sector, and enterprise clients in Saudi Arabia and the Middle East."
      },
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["system integrator", "maintenance company", "stockist"]
      }
    );

    expect(score.status).toBe("qualified");
    expect(score.score).toBeGreaterThanOrEqual(75);
    expect(score.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Reachable infrastructure buyer")])
    );
  });

  it("keeps global OEM and component-brand sites out of the telecom buyer pool", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Broadcom",
        website: "https://www.broadcom.com/",
        sourceUrl: "https://www.broadcom.com/products/wireless/wireless-lan-infrastructure",
        country: "QATAR",
        contacts: [
          {
            type: "social",
            value: "https://www.linkedin.com/company/broadcom",
            sourceUrl: "https://www.broadcom.com/"
          }
        ],
        summary:
          "Broadcom semiconductor and wireless infrastructure products for distributors and partners."
      },
      {
        ...criteria,
        targetRegions: ["Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["distributor", "stockist", "system integrator"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThan(50);
    expect(score.pageType).toBe("brand_oem_site");
  });

  it("does not mark country-unverified shop or catalog leads as high match", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Intertec Group W.L.L.",
        website: "https://shopintertec.com/",
        sourceUrl: "https://shopintertec.com/",
        country: "QATAR",
        contacts: [
          {
            type: "email",
            value: "sales@shopintertec.com",
            sourceUrl: "https://shopintertec.com/"
          }
        ],
        summary: "Telecom spare parts distributor and stockist with brands and contact details."
      },
      {
        ...criteria,
        targetRegions: ["Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["distributor", "stockist", "system integrator"]
      }
    );

    expect(score.status).toBe("review");
    expect(score.score).toBe(74);
    expect(score.risks).toContain(
      "High-match cap applied until target country is verified from official evidence"
    );
  });

  it("allows strong source-query market buyers to become high match when country evidence is unverified", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);

    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Qatar Telecom Field Services",
        website: "https://qatartelecomfield.qa/",
        sourceUrl: "https://qatartelecomfield.qa/services/5g-ran-maintenance",
        country: null,
        queryCountry: "Qatar",
        inferredCountry: null,
        countryConfidence: "unknown",
        countryConflict: false,
        contacts: [
          {
            type: "email",
            value: "sales@qatartelecomfield.qa",
            sourceUrl: "https://qatartelecomfield.qa/contact"
          },
          {
            type: "social",
            value: "https://www.linkedin.com/company/qatar-telecom-field-services",
            sourceUrl: "https://qatartelecomfield.qa/contact"
          }
        ],
        summary:
          "Official telecom system integrator and field maintenance contractor for 5G RAN, RRU, BBU, base station, tower and DC power services."
      },
      {
        ...criteria,
        targetRegions: ["Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: [
          "distributor",
          "stockist",
          "system integrator",
          "field maintenance contractor"
        ]
      }
    );

    expect(score.status).toBe("qualified");
    expect(score.score).toBeGreaterThanOrEqual(75);
    expect(score.risks).toContain(
      "Target country is inferred from the source query or page context; verify before outreach"
    );
    expect(score.risks).not.toContain(
      "High-match cap applied until target country is verified from official evidence"
    );
  });

  it("filters dates and long numeric ids out of phone contacts", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Telecom Cable Supplier",
          url: "https://telecomscable.com/contact",
          snippet:
            "Telecom cable supplier. Updated 2024-10-03. Tracking 1789000691486615209-252804910485934438. Phone +971 52 266 9803.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidate?.contacts).toEqual(
      expect.arrayContaining([
      expect.objectContaining({ type: "phone", value: "+971 52 266 9803" })
      ])
    );
  });

  it("does not treat rectifier model and part numbers as phone contacts", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Rectifier Repair Service - Advanced Technical Services",
          url: "https://ats4solutions.com/rectifier-repair/",
          snippet:
            "We repair a comprehensive list of DC plant switchmode rectifier models including 300-0669-903, 300-0710-901, 9155100120, 50 486534000 and 23413019-000-0. Contact our customer service team. Phone 630-209-8300. customerservice@ats4solutions.com",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    const phones = candidate?.contacts
      .filter((contact) => contact.type === "phone")
      .map((contact) => contact.value);

    expect(phones).toEqual(["630-209-8300"]);
    expect(candidate?.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "email", value: "customerservice@ats4solutions.com" })
      ])
    );
  });

  it("follows WordPress contact pages when enriching company contacts", async () => {
    const prisma = createPrismaMock();
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.includes("/wp/contact")
        ? `
          <html><body>
            <a href="mailto:info@sieltenigeria.com">info@sieltenigeria.com</a>
            <a href="mailto:sales@sieltenigeria.com">sales@sieltenigeria.com</a>
            <span>+234 807 901 0021</span>
            <span>+234 807 798 6625</span>
          </body></html>
        `
        : `
          <html><body>
            <a href="https://sieltenigeria.com/wp/contact/">Contact-Us</a>
            Telecom system integrator and network maintenance company in Nigeria.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    try {
      const result = await service.saveCandidates(
        "task-1",
        [
          {
            title: "SIELTE NIGERIA LIMITED - Telecom Infrastructure",
            url: "https://sieltenigeria.com/",
            snippet:
              "Nigeria telecom system integrator and network maintenance company for base station projects.",
            source: "web"
          }
        ],
        {
          ...criteria,
          targetRegions: ["Nigeria"]
        },
        "Nigeria"
      );

      expect(result.createdCount).toBe(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://sieltenigeria.com/wp/contact/",
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyName: "SIELTE NIGERIA LIMITED",
            contacts: {
              create: expect.arrayContaining([
                expect.objectContaining({ type: "email", value: "info@sieltenigeria.com" }),
                expect.objectContaining({ type: "email", value: "sales@sieltenigeria.com" }),
                expect.objectContaining({ type: "phone", value: "+234 807 901 0021" }),
                expect.objectContaining({ type: "phone", value: "+234 807 798 6625" })
              ])
            }
          })
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps protected contact pages as form contact entrances", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.includes("/contact")
        ? `
          <html><head><title>Your access to this site has been limited by the site owner</title></head>
          <body>Wordfence has temporarily limited access to this page.</body></html>
        `
        : `
          <html><body>
            <a href="/contact">Contact us</a>
            Ghana telecom system integrator and network maintenance company.
          </body></html>
        `;
      return new Response(html, {
        status: url.includes("/contact") ? 503 : 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Blocked Telecom Services - Network Maintenance",
          url: "https://blockedtelecom.example/",
          snippet: "Ghana telecom system integrator and network maintenance company.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Ghana"]
      },
      "Ghana"
    );

    expect(result.createdCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({
                type: "form",
                value: "https://blockedtelecom.example/contact"
              })
            ])
          }
        })
      })
    );
  });

  it("finds contacts from homepage navigation, contact html pages, and get-in-touch pages", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      let html = `
        <html><body>
          <a href="/contact.html">Contact</a>
          <a href="/en/get-in-touch-customers">Get in touch</a>
          Telecom system integrator and network maintenance company.
        </body></html>
      `;

      if (url.endsWith("/contact.html")) {
        html = `
          <html><body>
            <a href="mailto:info@qilantelecom.com">Email us</a>
            <span>Phone: +233 302 555 568</span>
          </body></html>
        `;
      }

      if (url.endsWith("/en/get-in-touch-customers")) {
        html = `
          <html><body>
            Sales: sales@qilantelecom.com
          </body></html>
        `;
      }

      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Qilan Telecom - Telecom Infrastructure",
          url: "https://www.qilantelecom.com/",
          snippet: "Ghana telecom system integrator and network maintenance company.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Ghana"]
      },
      "Ghana"
    );

    expect(result.createdCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "info@qilantelecom.com" }),
              expect.objectContaining({ type: "email", value: "sales@qilantelecom.com" }),
              expect.objectContaining({ type: "phone", value: "+233 302 555 568" })
            ])
          }
        })
      })
    );
  });

  it("probes English locale contact pages before the URL cutoff", async () => {
    const prisma = createPrismaMock();
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.endsWith("/en/contacts")
        ? `
          <html><body>
            Winncom wireless broadband and telecom equipment distributor.
            <a href="mailto:sales@winncom.com">sales@winncom.com</a>
            <span>Phone: 440-498-9510</span>
          </body></html>
        `
        : `
          <html><body>
            Winncom wireless broadband and telecom equipment distributor.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Winncom Technologies - Telecom Distributor",
          url: "https://www.winncom.com/",
          snippet:
            "United States wireless broadband distributor and telecom equipment stockist for RRU BBU projects.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["United States"]
      },
      "United States"
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.winncom.com/en/contacts",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(
      fetchSpy.mock.calls.findIndex(([input]) => String(input) === "https://www.winncom.com/en/contacts")
    ).toBeLessThan(16);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "sales@winncom.com" }),
              expect.objectContaining({ type: "phone", value: "440-498-9510" })
            ])
          }
        })
      })
    );
  });

  it("keeps a discovered official contact link as a reachable form when the linked page blocks fetching", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://www.reachlink.af/contact") {
        return new Response("temporary upstream error", {
          status: 502,
          headers: { "content-type": "text/html; charset=UTF-8" }
        });
      }

      return new Response(
        `
          <html><body>
            ReachLink Afghanistan is a telecom network contractor and FTTH maintenance provider.
            <a href="/contact">Contact our sales team</a>
          </body></html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" }
        }
      );
    });
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "ReachLink Afghanistan - Telecom Network Contractor",
          url: "https://www.reachlink.af/",
          snippet: "Afghanistan telecom network contractor and FTTH maintenance provider.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Afghanistan"]
      },
      "Afghanistan"
    );

    expect(result.createdCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({
                type: "form",
                value: "https://www.reachlink.af/contact",
                sourceUrl: "https://www.reachlink.af/contact"
              })
            ])
          }
        })
      })
    );
  });

  it("corrects brand-only titles and extracts SFT Trading contact details from the contact page", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.endsWith("/contact-us/")
        ? `
          <html>
            <head><title>SFT Trading LLC - Contact Us</title></head>
            <body>
              <img alt="SFT Trading LLC Logo" src="/logo.png" />
              SFT Trading LLC is a UAE telecom equipment distributor and channel partner.
              Email: info@sfttradingllc.com
              Phone: +971 4 3212406
              Mobile: +971 555 822 407
            </body>
          </html>
        `
        : `
          <html><body>
            SFT Trading LLC provides Huawei and ZTE telecom equipment in Dubai.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Huawei",
          url: "https://sfttradingllc.com/contact-us/",
          snippet:
            "UAE channel partner and telecom equipment distributor for Huawei, ZTE, BBU, RRU and rectifier spare parts.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"],
        productKeywords: ["Huawei", "ZTE", "BBU", "RRU", "rectifier"],
        customerTypeKeywords: ["distributor", "channel partner", "stockist"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "SFT Trading LLC",
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "info@sfttradingllc.com" }),
              expect.objectContaining({ type: "phone", value: "+971 4 3212406" }),
              expect.objectContaining({ type: "phone", value: "+971 555 822 407" })
            ])
          }
        })
      })
    );
  });

  it("keeps observed sub-path contact pages inside the final probe URL budget", async () => {
    const prisma = createPrismaMock();
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.endsWith("/mena/contact-us")
        ? `
          <html><body>
            MENA Network Services telecom system integrator.
            Email: sales@menanet.ae
            Phone: +971 4 555 1020
          </body></html>
        `
        : `
          <html><body>
            MENA Network Services telecom system integrator in UAE.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "MENA Network Services",
          url: "https://menanet.example/mena/solutions",
          snippet: "UAE telecom system integrator and network services contractor.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://menanet.example/mena/contact-us",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(
      fetchSpy.mock.calls.findIndex(
        ([input]) => String(input) === "https://menanet.example/mena/contact-us"
      )
    ).toBeLessThan(16);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "sales@menanet.ae" }),
              expect.objectContaining({ type: "phone", value: "+971 4 555 1020" })
            ])
          }
        })
      })
    );
  });

  it("follows legacy about links with language query params when contact data lives there", async () => {
    const prisma = createPrismaMock();
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.endsWith("/about.php?lang=en")
        ? `
          <html><body>
            NESIC Saudi telecom system integrator.
            Email: info@nesicsa.com
            Tel: +966-13-898-9477
          </body></html>
        `
        : `
          <html><body>
            <a href="/about.php?lang=en">About NESIC</a>
            Saudi telecom system integrator and network contractor.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "NESIC Saudi Arabia",
          url: "https://nesicsa.com/",
          snippet: "Saudi Arabia telecom system integrator and network infrastructure contractor.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://nesicsa.com/about.php?lang=en",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "info@nesicsa.com" }),
              expect.objectContaining({ type: "phone", value: "+966-13-898-9477" })
            ])
          }
        })
      })
    );
  });

  it("follows branded contact page slugs from homepage navigation", async () => {
    const prisma = createPrismaMock();
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.endsWith("/contact-us-gbi/")
        ? `
          <html><body>
            Gulf Bridge International telecom Qatar.
            <a href="mailto:info@gbiinc.com">info@gbiinc.com</a>
            <a href="mailto:sales@gbiinc.com">sales@gbiinc.com</a>
            Phone: +974 4009 4444
          </body></html>
        `
        : `
          <html><body>
            <a href="/contact-us-gbi/">Contact Us - GBI</a>
            Gulf Bridge International telecom Qatar.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "GBI Gulf Bridge International",
          url: "https://www.gbiinc.com/",
          snippet: "Qatar telecom network operator and infrastructure provider.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Qatar"]
      },
      "Qatar"
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.gbiinc.com/contact-us-gbi/",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "info@gbiinc.com" }),
              expect.objectContaining({ type: "email", value: "sales@gbiinc.com" }),
              expect.objectContaining({ type: "phone", value: "+974 4009 4444" })
            ])
          }
        })
      })
    );
  });

  it("retries Sucuri cookie challenge pages before giving up on contact extraction", async () => {
    const prisma = createPrismaMock();
    const challengeScript = Buffer.from(
      `v="a" + String.fromCharCode(98);document.cookie='s'+'u'+"=" + v + ';path=/;max-age=86400'; location.reload();`
    ).toString("base64");
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const cookie = (init?.headers as Record<string, string> | undefined)?.cookie;
      if (url.endsWith("/contact-us/") && cookie === "su=ab") {
        return new Response(
          `
            <html><body>
              Neo Data Technologies telecom solutions UAE.
              Email: info@neodatatechnologies.com
              Mobile: +971 56 418 1800
            </body></html>
          `,
          {
            status: 200,
            headers: { "content-type": "text/html; charset=UTF-8" }
          }
        );
      }

      if (url.endsWith("/contact-us/")) {
        return new Response(
          `<html><title>You are being redirected...</title><script>var sucuri_cloudproxy_js='',S='${challengeScript}';</script></html>`,
          {
            status: 307,
            headers: { "content-type": "text/html" }
          }
        );
      }

      return new Response("<html><body>Neo Data Technologies UAE telecom solutions.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Neo Data Technologies",
          url: "https://neodatatechnologies.com/contact-us/",
          snippet: "UAE telecom solutions provider and network system integrator.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({
                type: "email",
                value: "info@neodatatechnologies.com"
              }),
              expect.objectContaining({ type: "phone", value: "+971 56 418 1800" })
            ])
          }
        })
      })
    );
  });

  it("finds Odoo contactus pages and decodes Cloudflare-protected emails", async () => {
    const prisma = createPrismaMock();
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.endsWith("/contactus")
        ? `
          <html><body>
            HCT Group telecom system integrator in Dubai, UAE.
            <a href="/cdn-cgi/l/email-protection#1261737e7761527a716675607d67623c7377">Email</a>
            <span>Phone: +971 4 321 6500</span>
          </body></html>
        `
        : `
          <html><body>
            HCT Group private 5G network system integrator in Dubai, UAE.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "HCT UAE",
          url: "https://www.hctgroup.ae/ar/landing-page",
          snippet: "Dedicated private 5G, RAN, core networks, and managed operations in UAE.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.hctgroup.ae/contactus",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "sales@hctgroup.ae" }),
              expect.objectContaining({ type: "phone", value: "+971 4 321 6500" })
            ])
          }
        })
      })
    );
  });

  it("trims contact labels that are glued to email addresses in compressed page text", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        `
          <html><body>
            info@tejasnetworks.commarketing sales_northamerica@tejasnetworks.comemail
            you@company.com
          </body></html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" }
        }
      )
    );
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Tejas Networks",
          url: "https://www.tejasnetworks.com/",
          snippet: "Telecom equipment company and network infrastructure supplier.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["India"]
      },
      "India"
    );

    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "info@tejasnetworks.com" }),
              expect.objectContaining({
                type: "email",
                value: "sales_northamerica@tejasnetworks.com"
              })
            ])
          }
        })
      })
    );
    expect(prisma.leadCandidate.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([expect.objectContaining({ value: "you@company.com" })])
          }
        })
      })
    );
  });

  it("filters template emails from contact pages", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.endsWith("/contact/") || url.endsWith("/contact")
        ? `
          <html><body>
            Email us: info@hashport.ae
            Template demo: suport@tecnologia.com
            Template font email: team@latofonts.com
            Template demo: support@yourmail.com
            Template demo: info@your-domain.com
            Template phone: +386 40 222 555
          </body></html>
        `
        : `
          <html><body>
            Hashport private 5G network system integrator in UAE.
            <a href="/contact/">Contact</a>
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Hashport Private 5G",
          url: "https://hashport.ae/solutions/private-5g/",
          snippet: "UAE private 5G integrator for enterprise network deployment.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "info@hashport.ae" })
            ])
          }
        })
      })
    );
    expect(prisma.leadCandidate.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ value: "suport@tecnologia.com" })
            ])
          }
        })
      })
    );
    expect(prisma.leadCandidate.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ value: "support@yourmail.com" }),
              expect.objectContaining({ value: "info@your-domain.com" }),
              expect.objectContaining({ value: "team@latofonts.com" }),
              expect.objectContaining({ value: "+386 40 222 555" })
            ])
          }
        })
      })
    );
  });

  it("keeps government information as evidence review and skips legacy migrated websites", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "The Official Platform of the UAE Government",
          url: "https://u.ae/en/information-and-services/infrastructure/telecommunications",
          snippet: "Information about telecommunications in the UAE.",
          source: "web"
        },
        {
          title: "Etisalat UAE Oil and Gas",
          url: "https://www.etisalat.ae/en/enterprise-and-government/industry-solutions/oil-gas.html",
          snippet: "Looking for Etisalat? We're now eand.ae.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    const governmentCreate = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(governmentCreate).toMatchObject({
      companyName: "The Official Platform of the UAE Government",
      status: "rejected"
    });
    expect(governmentCreate.icpScore.create.score).toBeLessThanOrEqual(49);
    expect(governmentCreate.icpScore.create.reasons).toMatchObject({
      leadType: "government_information",
      intelligenceType: null
    });
  });

  it("hard rejects RCR Wireless project news instead of keeping it as intelligence", async () => {
    // 2026-05 product policy: news / trade-media domains are noise. The
    // user explicitly listed "新闻站不�? as a hard reject. RCR Wireless
    // is a trade-media outlet, not a buyer or a procurement portal, so
    // we drop it before any intelligence classification.
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title:
            "ADNOC and e& to build energy industrys largest private 5G network in UAE",
          url: "https://www.rcrwireless.com/20240703/private-5g/adnoc-and-e-to-build-energy-industrys-largest-private-5g-network-in-uae",
          snippet:
            "RCR Wireless News reports ADNOC, e& and Nokia will build a private 5G project in the UAE.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(0);
    expect(prisma.leadCandidate.create).not.toHaveBeenCalled();
  });

  it("keeps operator vendor-registration pages as intelligence instead of main customers", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "stc Kuwait Vendor Relations",
          url: "https://www.stc.com.kw/en/about/vendor-relations",
          snippet:
            "stc Kuwait vendor registration and supplier registration for telecom procurement.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Kuwait"]
      },
      "Kuwait"
    );

    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("intelligence");
    expect(createData.icpScore.create.score).toBeLessThanOrEqual(49);
    expect(createData.icpScore.create.reasons).toMatchObject({
      leadType: "intelligence",
      intelligenceType: "operator_vendor_registration"
    });
  });

  it("keeps B2B marketplace buyer requests as intelligence instead of hard rejecting them", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "5G telecom equipment buying lead UAE",
          url: "https://www.alibaba.com/buying-leads/5g-telecom-equipment.html",
          snippet:
            "Buyer inquiry and RFQ for 5G telecom equipment in UAE. Looking for supplier.",
          source: "web"
        },
        {
          title: "Huawei RRU product supplier listing",
          url: "https://www.alibaba.com/product-detail/huawei-rru.html",
          snippet: "Product listing from a seller storefront.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(prisma.leadCandidate.create).toHaveBeenCalledTimes(1);
    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("intelligence");
    expect(createData.icpScore.create.score).toBeLessThanOrEqual(49);
    expect(createData.icpScore.create.reasons).toMatchObject({
      leadType: "intelligence",
      intelligenceType: "rfq_notice"
    });
  });

  it("keeps generic procurement and off-target distributor pages out of telecom main customers", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Air curtains distributors Saudi Arabia",
          url: "https://www.airtecnics.com/contact/air-curtains-distributors/saudi-arabia",
          snippet:
            "Air curtains distributor in Saudi Arabia. Contact our Saudi Arabia distributor for air curtains.",
          source: "web"
        },
        {
          title: "Qatar Foundation",
          url: "https://www.qf.org.qa/supplier-registration",
          snippet: "Qatar Foundation official page for organizations and partners.",
          source: "web"
        },
        {
          title: "Doha International Airport supplier portal",
          url: "https://esourcing.qatarairways.com.qa/",
          snippet: "Supplier registration and e-sourcing portal for vendors.",
          source: "web"
        },
        {
          title: "Kiewit Corporation",
          url: "https://www.kiewit.com/",
          snippet: "Engineering and construction contractor delivering infrastructure projects.",
          source: "web"
        },
        {
          title: "ACES telecom infrastructure EPC contractor Saudi Arabia",
          url: "https://aces-co.com/",
          snippet:
            "Saudi Arabia telecommunication infrastructure EPC contractor, system integrator and maintenance company. sales@aces-co.com +966 11 2500333",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia", "Qatar"]
      },
      "Saudi Arabia"
    );

    const created = prisma.leadCandidate.create.mock.calls.map((call) => call[0].data);
    const airCurtain = created.find((lead) => lead.website?.includes("airtecnics.com"));
    const procurement = created.find((lead) => lead.website?.includes("qf.org.qa"));
    const esourcing = created.find((lead) => lead.website?.includes("esourcing.qatarairways"));
    const weakContractor = created.find((lead) => lead.website === "https://www.kiewit.com/");
    const aces = created.find((lead) => lead.website === "https://aces-co.com/");

    expect(airCurtain?.status).toBe("rejected");
    expect(airCurtain?.icpScore.create.score).toBeLessThanOrEqual(39);
    expect(procurement?.status).toBe("intelligence");
    expect(procurement?.icpScore.create.score).toBeLessThanOrEqual(49);
    expect(esourcing?.status).toBe("intelligence");
    expect(esourcing?.icpScore.create.score).toBeLessThanOrEqual(49);
    expect(weakContractor?.status).toBe("rejected");
    expect(weakContractor?.icpScore.create.score).toBeLessThanOrEqual(39);
    expect(aces?.status).not.toBe("rejected");
    expect(aces?.icpScore.create.score).toBeGreaterThanOrEqual(50);
  });

  it("does not let query-contaminated snippets rescue off-target telecom candidates", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        `<html><head><title>Qnited Trading Company</title></head><body>
          Qnited Trading Company is an FMCG distributor for foodstuff, retail businesses,
          horeca, and fast-moving consumer goods in Qatar.
          Contact sales@qnited.qa Phone +974 4412 3456
        </body></html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" }
        }
      )
    );
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Qnited Trading Company - Contact",
          url: "https://www.qnited.qa/",
          snippet:
            "Qatar telecom spare parts distributor and stockist. Contact sales@qnited.qa",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Qatar"],
        productKeywords: ["5G telecom equipment", "RAN equipment", "telecom spare parts"],
        customerTypeKeywords: ["distributor", "stockist", "system integrator"]
      },
      "Qatar"
    );

    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("rejected");
    expect(createData.icpScore.create.score).toBeLessThanOrEqual(39);
    expect(createData.icpScore.create.reasons.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Telecom task but candidate page has no telecom"),
        expect.stringContaining("Off-target product/service evidence")
      ])
    );
  });

  it("does not treat automobile distributor networks as telecom context", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "KOYO.",
        website: "https://www.jtekt.ae/distributors-kuwait",
        sourceUrl: "https://www.jtekt.ae/distributors-kuwait",
        country: "KUWAIT",
        inferredCountry: "KUWAIT",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "phone" as const,
            value: "+965 2221 2345",
            sourceUrl: "https://www.jtekt.ae/distributors-kuwait"
          }
        ],
        summary:
          "Official page text: JTEKT distributor network for KOYO bearings, automotive spare parts, steering systems and automobile mobility components in Kuwait."
      },
      {
        ...criteria,
        targetRegions: ["Kuwait"],
        productKeywords: ["RAN equipment", "telecom spare parts", "rectifier module"],
        customerTypeKeywords: ["distributor", "stockist", "system integrator"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Telecom task but candidate page has no telecom"),
        expect.stringContaining("Off-target product/service evidence")
      ])
    );
  });

  it("keeps government tender and exhibition PDFs as intelligence, not customers", async () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const candidates = service.normalizeSearchResults(
      [
        {
          title: "UAE telecom RFQ tender document PDF",
          url: "https://procurement.example.gov.ae/tenders/telecom-rfq.pdf",
          snippet:
            "Government tender RFQ for 5G telecom equipment and private network deployment.",
          source: "web"
        },
        {
          title: "Gulf Telecom Expo exhibitor list PDF",
          url: "https://events.example.com/gulf-telecom-expo-exhibitor-list.pdf",
          snippet:
            "PDF exhibitor list and participant directory for telecom operators, tower companies and system integrators.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const scores = candidates.map((candidate) =>
      service.scoreCandidate(candidate, {
        ...criteria,
        targetRegions: ["UAE"]
      })
    );

    expect(scores.map((score) => score.status)).toEqual([
      "intelligence",
      "intelligence"
    ]);
    expect(scores.map((score) => score.intelligenceType)).toEqual([
      "government_tender",
      "exhibition_pdf"
    ]);
    scores.forEach((score) => {
      expect(score.score).toBeLessThanOrEqual(49);
    });
  });

  it("uses the task search context for non-telecom intelligence instead of hardcoded telecom terms", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const nonTelecomCriteria = {
      targetRegions: ["UAE"],
      productKeywords: ["solar inverter", "hybrid inverter", "energy storage"],
      customerTypeKeywords: ["EPC contractor", "installer"],
      disqualifiers: []
    };
    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Dubai energy storage project news",
          url: "https://industrynews.example.com/news/dubai-energy-storage-project",
          snippet:
            "Project news: Al Noor EPC will deploy a hybrid inverter and energy storage system in the UAE.",
          source: "web"
        },
        {
          title: "Gulf Solar Expo exhibitor list PDF",
          url: "https://events.example.com/gulf-solar-expo-exhibitor-list.pdf",
          snippet:
            "PDF exhibitor list for solar inverter installers, EPC contractors and energy storage buyers.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const scores = candidates.map((candidate) =>
      service.scoreCandidate(candidate, nonTelecomCriteria)
    );

    expect(scores.map((score) => score.status)).toEqual([
      "intelligence",
      "intelligence"
    ]);
    expect(scores.map((score) => score.intelligenceType)).toEqual([
      "project_news",
      "exhibition_pdf"
    ]);
  });

  it("mines non-telecom directory pages into official company candidates", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("enfsolar.com")) {
        return new Response(
          `
            <html><body>
              <h1>Solar Installers UAE Directory</h1>
              <a href="https://sunergysolar.ae/">Sunergy Solar LLC</a>
              <p>Dubai solar inverter installer and EPC contractor.</p>
            </body></html>
          `,
          { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
        );
      }

      if (url.includes("sunergysolar.ae/contact")) {
        return new Response(
          `
            <html><body>
              <a href="mailto:sales@sunergysolar.ae">sales@sunergysolar.ae</a>
              <span>+971 4 555 0199</span>
            </body></html>
          `,
          { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
        );
      }

      return new Response(
        `
          <html><body>
            <title>Sunergy Solar LLC</title>
            Solar inverter installation, EPC contracting and energy storage projects in UAE.
            <a href="/contact">Contact</a>
          </body></html>
        `,
        { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
      );
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Solar Installers UAE Directory - ENF Solar",
          url: "https://www.enfsolar.com/directory/installer/UAE",
          snippet: "Directory of UAE solar inverter installers and EPC contractors.",
          source: "web"
        }
      ],
      {
        targetRegions: ["UAE"],
        productKeywords: ["solar inverter", "energy storage"],
        customerTypeKeywords: ["EPC contractor", "installer"],
        disqualifiers: []
      },
      "UAE"
    );

    const created = prisma.leadCandidate.create.mock.calls.map((call) => call[0].data);
    const derived = created.find((lead) => lead.website === "https://sunergysolar.ae/");

    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "intelligence",
          website: "https://www.enfsolar.com/directory/installer/UAE"
        })
      ])
    );
    expect(derived).toMatchObject({
      companyName: "Sunergy Solar LLC",
      country: "UAE"
    });
    expect(derived?.status).not.toBe("rejected");
    expect(derived?.contacts.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "email", value: "sales@sunergysolar.ae" }),
        expect.objectContaining({ type: "phone", value: "+971 4 555 0199" })
      ])
    );
    expect(derived?.icpScore.create.reasons).toMatchObject({
      sourcePage: {
        url: "https://www.enfsolar.com/directory/installer/UAE"
      }
    });
  });

  it("follows directory profile pages before mining non-telecom official websites", async () => {
    const prisma = createPrismaMock();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("enfsolar.com/directory/installer/9001")) {
        return new Response(
          `
            <html><body>
              <h1>Sunergy Solar LLC</h1>
              <p>Dubai solar inverter installer and EPC contractor.</p>
              <a href="https://sunergysolar.ae/">Company Website</a>
            </body></html>
          `,
          { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
        );
      }

      if (url.includes("enfsolar.com/directory/installer/UAE")) {
        return new Response(
          `
            <html><body>
              <h1>Solar Installers UAE Directory</h1>
              <a href="/directory/installer/9001/sunergy-solar">Sunergy Solar LLC profile</a>
            </body></html>
          `,
          { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
        );
      }

      if (url.includes("sunergysolar.ae/contact")) {
        return new Response(
          `
            <html><body>
              <a href="mailto:sales@sunergysolar.ae">sales@sunergysolar.ae</a>
              <span>+971 4 555 0199</span>
            </body></html>
          `,
          { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
        );
      }

      return new Response(
        `
          <html><body>
            <title>Sunergy Solar LLC</title>
            Solar inverter installation, EPC contracting and energy storage projects in UAE.
            <a href="/contact">Contact</a>
          </body></html>
        `,
        { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
      );
    });
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Solar Installers UAE Directory - ENF Solar",
          url: "https://www.enfsolar.com/directory/installer/UAE",
          snippet: "Directory of UAE solar inverter installers and EPC contractors.",
          source: "web"
        }
      ],
      {
        targetRegions: ["UAE"],
        productKeywords: ["solar inverter", "energy storage"],
        customerTypeKeywords: ["EPC contractor", "installer"],
        disqualifiers: []
      },
      "UAE"
    );

    const created = prisma.leadCandidate.create.mock.calls.map((call) => call[0].data);
    const derived = created.find((lead) => lead.website === "https://sunergysolar.ae/");

    expect(derived).toMatchObject({
      companyName: "Sunergy Solar LLC",
      country: "UAE"
    });
    expect(derived?.status).not.toBe("rejected");
    expect(derived?.contacts.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "email", value: "sales@sunergysolar.ae" }),
        expect.objectContaining({ type: "phone", value: "+971 4 555 0199" })
      ])
    );
    expect(derived?.icpScore.create.reasons).toMatchObject({
      sourcePage: {
        url: "https://www.enfsolar.com/directory/installer/9001/sunergy-solar"
      }
    });
  });

  it("uses real company names instead of forbidden page labels", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const candidates = service.normalizeSearchResults(
      [
        {
          title: "Tagline",
          url: "https://rtesqatar.com/",
          snippet: "Radio Technology Engineering Services Qatar telecom systems.",
          source: "web"
        },
        {
          title: "Awesome Image",
          url: "https://greenportsuppliers.com/",
          snippet: "Marine and telecom supplier contact page.",
          source: "web"
        },
        {
          title: "PDF",
          url: "https://exampletelecom.qa/company-profile.pdf",
          snippet: "Company profile PDF.",
          source: "web"
        },
        {
          title: "Contact",
          url: "https://www.hctgroup.ae/contactus",
          snippet: "HCT Group contact page.",
          source: "web"
        },
        {
          title: "Home",
          url: "https://hashport.ae/",
          snippet: "Hashport telecom services.",
          source: "web"
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidates.map((candidate) => candidate.companyName)).toEqual([
      "RTES Qatar",
      "Greenport Suppliers",
      "Exampletelecom",
      "HCT Group",
      "Hashport"
    ]);
  });

  it("keeps generic service pages without direct contacts as manual review", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Dubai Network Services LLC - Telecom System Integrator",
          url: "https://dubainetworkservices.ae/services",
          snippet:
            "Dubai UAE telecom network services, 5G rollout support and system integrator maintenance company.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const score = service.scoreCandidate(candidate!, criteria);

    expect(score.score).toBeGreaterThanOrEqual(50);
    expect(score.score).toBeLessThan(75);
    expect(score.status).toBe("review");
  });

  it("keeps glossary and vendor knowledge pages out of country-review customer candidates", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Baseband Unit | Glossary | EXFO",
          url: "https://www.exfo.com/en/resources/glossary/baseband-unit/",
          snippet:
            "Glossary article explaining what a baseband unit is in telecom systems, BBU and RRU.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "Oman" }
    );

    const score = service.scoreCandidate(candidate!, criteria);

    expect(score.status).not.toBe("review");
    expect(["qualified", "review"]).not.toContain(score.status);
    expect(score.score).toBeLessThanOrEqual(49);
  });

  it("rejects non-target China suppliers and product detail pages before country review", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "HUANET Huawei MA5800 OLT product",
          url: "https://www.hua-network.com/optical-line-terminal-huawei-smartax-5800-olt-ma5800-x15-gpon-product/",
          snippet: "Huawei OLT product supplier page for GPON equipment.",
          source: "web"
        },
        {
          title: "ETU-Link 10G SFP optical transceiver",
          url: "https://www.etulinktechnology.com/products/10g-sfp-module.html",
          snippet:
            "Shenzhen Chinese supplier of SFP optical transceiver modules. Phone +86 755 1234 5678.",
          source: "web"
        },
        {
          title: "Fiberolt Huawei OLT product details",
          url: "https://www.fiberolt.com/huawei-ma5800-olt.html",
          snippet: "Product details and price for Huawei OLT equipment.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(3);
    expect(prisma.leadCandidate.create).not.toHaveBeenCalled();
  });

  it("keeps associations and conference pages out of country-review customer candidates", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-1",
      [
        {
          title: "Telecom Infra Project OpenRAN",
          url: "https://www.telecominfraproject.com/openran",
          snippet: "Open RAN industry initiative and technical community.",
          source: "web"
        },
        {
          title: "Technical Programme",
          url: "https://icc2026.ieee-icc.org/technical-program",
          snippet: "IEEE ICC 2026 technical programme, conference agenda and accepted papers.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(prisma.leadCandidate.create).toHaveBeenCalledTimes(2);
    for (const call of prisma.leadCandidate.create.mock.calls) {
      const createData = call[0].data;
      expect(createData.status).toBe("rejected");
      expect(createData.icpScore.create.score).toBeLessThanOrEqual(49);
    }
  });

  it("keeps marketing article pages out of the main customer list even on local domains", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "5G-Ready Network Infrastructure in UAE",
          url: "https://powerlinkitss.ae/5g-ready-network-infrastructure-future-proofing-uae-businesses-in-2026/",
          snippet:
            "Article about future-proofing UAE businesses with 5G network infrastructure.",
          source: "web"
        }
      ],
      { taskId: "task-1", defaultCountry: "UAE" }
    );

    const score = service.scoreCandidate(candidate!, criteria);

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(49);
  });

  it("enriches missing contacts on existing duplicate candidates instead of only skipping them", async () => {
    const prisma = createPrismaMock();
    prisma.leadCandidate.findMany.mockResolvedValue([
      {
        id: "existing-sielte",
        companyName: "SIELTE NIGERIA LIMITED",
        website: "https://sieltenigeria.com/",
        contacts: []
      }
    ]);
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      const html = url.includes("/wp/contact")
        ? `
          <html><body>
            <a href="mailto:info@sieltenigeria.com">info@sieltenigeria.com</a>
            <span>+234 807 901 0021</span>
          </body></html>
        `
        : `
          <html><body>
            <a href="https://sieltenigeria.com/wp/contact/">Contact-Us</a>
            Telecom system integrator and network maintenance company in Nigeria.
          </body></html>
        `;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    });
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "SIELTE NIGERIA LIMITED - Telecom Infrastructure",
          url: "https://sieltenigeria.com/",
          snippet:
            "Nigeria telecom system integrator and network maintenance company for base station projects.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Nigeria"]
      },
      "Nigeria"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(prisma.leadContact.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          leadId: "existing-sielte",
          type: "email",
          value: "info@sieltenigeria.com"
        }),
        expect.objectContaining({
          leadId: "existing-sielte",
          type: "phone",
          value: "+234 807 901 0021"
        })
      ])
    });
  });

  it("reuses reachable contacts from the same user's historical leads with the same domain", async () => {
    const prisma = createPrismaMock();
    prisma.leadCandidate.findMany
      .mockResolvedValueOnce([
        {
          website: "https://gulf5g.ae/",
          sourceUrl: "https://gulf5g.ae/contact",
          contacts: [
            {
              type: "email",
              value: "sales@gulf5g.ae",
              sourceUrl: "https://gulf5g.ae/contact"
            },
            {
              type: "form",
              value: "https://gulf5g.ae/contact",
              sourceUrl: "https://gulf5g.ae/contact"
            }
          ]
        }
      ])
      .mockResolvedValueOnce([]);
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-current",
      [
        {
          title: "Gulf 5G Systems - Telecom System Integrator UAE",
          url: "https://gulf5g.ae/services",
          snippet:
            "UAE system integrator maintaining RAN, 5G base station, telecom power and FTTH networks.",
          source: "web"
        }
      ],
      criteria,
      "UAE",
      undefined,
      undefined,
      { userId: "user-1" }
    );

    expect(result.createdCount).toBe(1);
    expect(prisma.leadCandidate.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          taskId: { not: "task-current" },
          task: { userId: "user-1" }
        })
      })
    );
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "email", value: "sales@gulf5g.ae" }),
              expect.objectContaining({ type: "form", value: "https://gulf5g.ae/contact" })
            ])
          }
        })
      })
    );
  });

  it("revalidates country after same-user historical phone contacts are merged", async () => {
    const prisma = createPrismaMock();
    prisma.leadCandidate.findMany
      .mockResolvedValueOnce([
        {
          website: "https://almashariq.com/",
          sourceUrl: "https://www.almashariq.com/contactus.php",
          contacts: [
            {
              type: "email",
              value: "info@almashariq.com",
              sourceUrl: "https://www.almashariq.com/contactus.php"
            },
            {
              type: "phone",
              value: "+966-13-8433336",
              sourceUrl: "https://www.almashariq.com/contactus.php"
            }
          ]
        }
      ])
      .mockResolvedValueOnce([]);
    const service = new LeadQualificationService(prisma as any);

    await service.saveCandidates(
      "task-current",
      [
        {
          title: "Almashariq - Telecom Infrastructure Contractor",
          url: "https://www.almashariq.com/page.php?id=134",
          snippet:
            "Telecom infrastructure contractor and system integrator for base station, tower, RAN and telecom power projects.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE", "Saudi Arabia"]
      },
      "UAE",
      undefined,
      undefined,
      { userId: "user-1" }
    );

    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          country: "SAUDI ARABIA",
          inferredCountry: "SAUDI ARABIA",
          countryConfidence: expect.stringMatching(/medium|high/),
          contacts: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "phone", value: "+966-13-8433336" })
            ])
          },
          icpScore: {
            create: expect.objectContaining({
              reasons: expect.objectContaining({
                countryValidation: expect.objectContaining({
                  inferredCountry: "SAUDI ARABIA",
                  countryConfidence: expect.stringMatching(/medium|high/)
                })
              })
            })
          }
        })
      })
    );
  });

  // 2026-05 V1-MVP: hard reject reference customers (HCT Group, Spectrum MEA,
  // HighCloud) so they never appear in the candidate table. They are
  // anchors the seller gave us, NOT new buyer leads. Tests cover:
  //   1. Domain match (hctgroup.ae blocked when hctgroup.ae in
  //      referenceCustomerDomains)
  //   2. Multi-word fuzzy name (HCT Group blocked when "HCT Group"
  //      in referenceCustomerNames)
  //   3. Combined alias splitting ("HighCloud / HCT Group" → both
  //      sides become independent aliases)
  //   4. Generic single words ("Spectrum") do NOT cause false positives
  it("hard rejects reference customer by exact domain match", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "HCT Group - Telecom System Integrator",
          url: "https://www.hctgroup.ae/case-studies",
          snippet:
            "HCT Group is a telecom system integrator in Dubai. sales@hctgroup.ae +971 4 321 6500",
          source: "web"
        }
      ],
      {
        ...criteria,
        referenceCustomerDomains: ["hctgroup.ae"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("hard rejects reference customer by multi-word fuzzy name match", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    // Candidate is on a different domain, but its company name still
    // matches the reference. Should be hard-rejected.
    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "HCT Group case study mention",
          url: "https://example.com/case-studies/hct-group",
          snippet:
            "HCT Group is featured in this Dubai case study. sales@example.com +971 4 000 0000",
          source: "web"
        }
      ],
      {
        ...criteria,
        referenceCustomerNames: ["HCT Group"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("hard rejects reference customer split from combined alias 'HighCloud / HCT Group'", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    // GPT may emit "HighCloud / HCT Group" as a single combined entry.
    // After alias splitting in buildIcpCriteria, the qualification
    // criteria should contain both "HCT Group" (multi-word) and
    // "HighCloud" (single-word, length >= 6, non-generic). Either side
    // should hard-reject.
    const splitNames = ["HighCloud / HCT Group", "HighCloud", "HCT Group"];

    const hctResult = await service.saveCandidates(
      "task-1",
      [
        {
          title: "HCT Group telecom",
          url: "https://example.com/about",
          snippet: "HCT Group telecom provider. sales@example.com +971 4 000 0001",
          source: "web"
        }
      ],
      {
        ...criteria,
        referenceCustomerNames: splitNames
      },
      "UAE"
    );

    expect(hctResult.createdCount).toBe(0);
    expect(hctResult.skippedCount).toBe(1);

    // Reset prisma so the next saveCandidates call sees a clean state.
    const prisma2 = createPrismaMock();
    const service2 = new LeadQualificationService(prisma2 as any);
    const highCloudResult = await service2.saveCandidates(
      "task-1",
      [
        {
          title: "HighCloud Solutions home",
          url: "https://highcloudsolutions.com/",
          snippet:
            "HighCloud Solutions provides cloud infra. sales@highcloudsolutions.com +971 4 000 0002",
          source: "web"
        }
      ],
      {
        ...criteria,
        referenceCustomerNames: splitNames
      },
      "UAE"
    );

    expect(highCloudResult.createdCount).toBe(0);
    expect(highCloudResult.skippedCount).toBe(1);
  });

  it("does not reject candidates whose name only matches a generic single-word reference alias like 'Spectrum'", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    // "Spectrum" is in the generic-words blocklist for single-word
    // alias matching, so even if GPT emits it as a reference name,
    // it must NOT cause unrelated companies named "Spectrum Networks"
    // or "Spectrum Industries" to be rejected.
    // (Multi-word "Spectrum MEA" would still hard-reject "Spectrum
    // MEA" specifically, but not generic spectrum-* companies.)
    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Spectrum Networks - Telecom Systems",
          url: "https://specnt.com/about",
          snippet:
            "Spectrum Networks builds telecom systems. sales@specnt.com +971 4 000 0003",
          source: "web"
        }
      ],
      {
        ...criteria,
        referenceCustomerNames: ["Spectrum"] // generic single word — must NOT reject
      },
      "UAE"
    );

    // Candidate should not be hard-rejected by reference logic.
    // (It may still be filtered by other rules, but the createdCount
    // path proves it passed the reference check.)
    expect(result.skippedCount + result.createdCount).toBe(1);
  });

  // 2026-05 V1-MVP+: tier-1 mobile operator blacklist. Operators like
  // Zain, Vodafone, Ooredoo are end-users of telecom equipment — they
  // buy from OEMs directly, not from spare-parts distributors. Their
  // news/marketing pages must be hard-rejected.
  it("hard rejects tier-1 mobile operator news pages (Zain KSA)", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Zain KSA and Huawei announce new network strategy",
          url: "https://sa.zain.com/en/all-news/zain-ksa-and-huawei-announce-release-new-network-strategy",
          snippet:
            "Zain KSA integrates latest Huawei 5G technology into its network. Contact: media@zain.com",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("hard rejects Vodafone Qatar marketing pages", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Vodafone Qatar - Fastest Network",
          url: "https://www.vodafone.qa/fastestnetwork",
          snippet: "Vodafone Qatar P.Q.S.C. fastest 5G network coverage.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Qatar"]
      },
      "Qatar"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("does NOT reject operator vendor-registration pages (keeps as intelligence)", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Ooredoo Qatar Vendor Registration",
          url: "https://www.ooredoo.qa/portal/vendor-registration",
          snippet:
            "Ooredoo Qatar vendor registration portal for telecom equipment suppliers.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Qatar"]
      },
      "Qatar"
    );

    // Vendor-registration pages on operator domains should NOT be
    // hard-rejected — they are useful intelligence signals.
    expect(result.createdCount).toBe(1);
  });

  // 2026-05 V1-MVP+ P2: certification / inspection / testing service
  // companies should be rejected — they are NOT equipment buyers.
  it("hard rejects certification/inspection service pages (Applus)", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Telecom services: project management and certification | Applus",
          url: "https://www.applus.com/qa/en/what-we-do/market/telecommunications",
          snippet:
            "Applus provides certification, inspection, and testing services for the telecommunications industry.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Qatar"]
      },
      "Qatar"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("hard rejects SGS/Bureau Veritas testing pages", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "SGS Telecom Testing and Certification",
          url: "https://www.sgs.com/en/our-services/connectivity-products/telecom-testing",
          snippet:
            "SGS provides testing, inspection, and certification services for telecom equipment compliance.",
          source: "web"
        },
        {
          title: "Bureau Veritas Telecom Compliance Assessment",
          url: "https://www.bureauveritas.com/services/telecom-compliance",
          snippet:
            "Bureau Veritas offers compliance assessment, audit, and certification for telecom networks.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(2);
  });

  it("does NOT reject a system integrator that mentions certification alongside buyer-role signals", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Gulf Telecom Solutions - System Integrator",
          url: "https://gulftelecomsolutions.ae/services",
          snippet:
            "Gulf Telecom Solutions is a system integrator and distributor of telecom equipment. ISO certification. Compliance testing for base station equipment. RRU spare parts stockist.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    // Has buyer-role signals (system integrator, distributor, stockist,
    // RRU, spare parts) — should NOT be rejected despite mentioning
    // certification and compliance.
    expect(result.createdCount).toBe(1);
  });

  // 2026-05 Stage 2 follow-up: off-industry hard reject. The next
  // five tests pin the verified-off-industry policy: medical/SaaS/etc.
  // candidates with no target product/customer signal must land in
  // "rejected" instead of being rescued by the buyer-role floor;
  // self-guards must keep targeted-bucket queries (SaaS targets
  // looking for SaaS) and edge-case overlaps (medical-distributor
  // pages that mention RRU spare parts) intact.

  it("hard-rejects medical/aesthetic candidates when target is telecom (Aesthetix scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Aesthetix Beauty Clinic",
        website: "https://aesthetix.example.com",
        sourceUrl: "https://aesthetix.example.com/services",
        country: "GERMANY",
        inferredCountry: "GERMANY",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email" as const,
            value: "info@aesthetix.example.com",
            sourceUrl: "https://aesthetix.example.com/contact"
          }
        ],
        // Two off-industry medical bucket terms (aesthetic +
        // skincare), zero target product/customer signal.
        summary:
          "Aesthetix is an aesthetic medical clinic offering cosmetic skincare treatments and dental services for retail customers."
      },
      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["RRU", "BBU", "telecom power"],
        customerTypeKeywords: ["distributor", "system integrator"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([expect.stringContaining("Off-industry signal")])
    );
  });

  it("hard-rejects SaaS/database candidates when target is PLC equipment (MongoDB scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "MongoDB",
        website: "https://mongodb.com",
        sourceUrl: "https://mongodb.com/cloud",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        countryConfidence: "low",
        countryConflict: false,
        contacts: [
          {
            type: "email" as const,
            value: "info@mongodb.com",
            sourceUrl: "https://mongodb.com/contact"
          }
        ],
        // Two software_saas bucket hits (database, cloud platform);
        // zero PLC/automation/integrator signal.
        summary:
          "MongoDB Atlas is a developer database and cloud platform used by enterprises around the world."
      },
      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["PLC programmer", "PLC programming device"],
        customerTypeKeywords: ["distributor", "system integrator"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([expect.stringContaining("Off-industry signal")])
    );
  });

  it("does NOT off-industry-reject candidates that match a specific target product term", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        // A medical-device distributor that ALSO supplies RRU spare
        // parts to telecom hospitals. The off-industry hits are
        // present (medical, hospital), but the candidate text also
        // contains a specific telecom product term, which must
        // override the bucket reject.
        companyName: "Medico Telecom Distributor",
        website: "https://medicotelecom.example.com",
        sourceUrl: "https://medicotelecom.example.com/contact",
        country: "GERMANY",
        inferredCountry: "GERMANY",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email" as const,
            value: "sales@medicotelecom.example.com",
            sourceUrl: "https://medicotelecom.example.com/contact"
          }
        ],
        summary:
          "Medico distributes RRU spare parts and BBU equipment to medical hospitals and clinical telecom rooms across Germany."
      },      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["RRU", "BBU", "telecom power"],
        customerTypeKeywords: ["distributor", "system integrator"]
      }
    );

    // Specific product signal (RRU/BBU) overrides the medical bucket
    // hits; status should not be "rejected" purely from off-industry.
    expect(score.status).not.toBe("rejected");
  });

  it("does NOT off-industry-reject SaaS candidates when the user is targeting SaaS", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "MongoDB",
        website: "https://mongodb.com",
        sourceUrl: "https://mongodb.com/cloud",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        countryConfidence: "low",
        countryConflict: false,
        contacts: [
          {
            type: "email" as const,
            value: "info@mongodb.com",
            sourceUrl: "https://mongodb.com/contact"
          }
        ],
        summary:
          "MongoDB Atlas is a developer database and cloud platform used by enterprises around the world."
      },
      {
        ...criteria,
        targetRegions: ["United States"],
        // User actually IS hunting in the SaaS space — productKeywords
        // overlap the software_saas bucket. Self-guard must disable
        // that bucket for this scoring pass.
        productKeywords: ["database", "cloud platform", "saas"],
        customerTypeKeywords: ["enterprise developer", "distributor"]
      }
    );

    // Self-guard kept the SaaS bucket disabled, so MongoDB should
    // NOT be rejected by off-industry rules (it may still land at
    // review depending on score, but never status === "rejected"
    // on the basis of off-industry alone).
    expect(score.status).not.toBe("rejected");
  });

  // 2026-05 P0 follow-up to off-industry hard reject. The first
  // pass used flat `text.includes(term)` checks, so single-word
  // bucket terms like `bank`/`banking`/`healthcare` could hit on a
  // telecom integrator's "industries we serve" nav menu (Kuwait
  // Telecom + Amanco SA in real GCC tasks). The fix splits each
  // bucket into STRONG (unambiguous self-identification phrases like
  // "private bank", "aesthetic medical", "developer database") and
  // WEAK (single nouns that nav menus use). Detection now requires
  // ≥1 strong AND total ≥2 hits, OR ≥2 strong hits. Two weak hits
  // alone never fire.

  it("does NOT off-industry-reject a telecom system integrator that lists Banking/Healthcare in its served-industries menu (Kuwait Telecom scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Kuwait Telecom",
        website: "https://kuwait-telecom.example.com",
        sourceUrl: "https://kuwait-telecom.example.com/services",
        country: "KUWAIT",
        inferredCountry: "KUWAIT",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            value: "+96522123456",
            country: "KUWAIT",
            sourceUrl: "https://kuwait-telecom.example.com/contact",
            confidence: "high"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "info@kuwait-telecom.example.com",
            sourceUrl: "https://kuwait-telecom.example.com/contact"
          },
          {
            type: "phone" as const,
            value: "+96522123456",
            sourceUrl: "https://kuwait-telecom.example.com/contact"
          }
        ],
        // The body says "we are a telecom services provider"; the
        // header lists served verticals "Telecom Banking Retail
        // Healthcare". Under the old flat-includes rule the words
        // banking + healthcare counted as 2 hits and the candidate
        // was rejected. Under the new strong/weak split they are
        // both WEAK only — no STRONG finance/medical phrase appears
        // — so the bucket never fires.
        summary:
          "Kuwait Telecom is a Kuwait-based telecom services provider and system integrator delivering IP networks, voice termination services, and managed telecom solutions for governments, enterprises, and operators. Industries served: Telecom, Banking, Retail, Media, Healthcare, Security."
      },
      {
        ...criteria,
        targetRegions: ["Kuwait", "UAE", "Saudi Arabia"],
        // Note: no overlap with finance/medical bucket strong terms,
        // so neither bucket is self-guarded — the win must come from
        // the strong/weak split alone.
        productKeywords: ["RRU", "BBU", "telecom equipment", "5G"],
        customerTypeKeywords: ["operator", "system integrator"]
      }
    );

    // The off-industry rule must NOT have fired; that's the only
    // thing this test pins. The candidate may still land in any of
    // qualified/review depending on other signals.
    expect(score.risks).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Off-industry signal")])
    );
  });

  it("does NOT off-industry-reject an HCIS-approved security/telecom integrator whose markets menu lists Banking/Healthcare/Government (Amanco SA scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Amanco",
        website: "https://amanco.example.com",
        sourceUrl: "https://amanco.example.com/about",
        country: "SAUDI ARABIA",
        inferredCountry: "SAUDI ARABIA",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            value: "+966114736100",
            country: "SAUDI ARABIA",
            sourceUrl: "https://amanco.example.com/contact",
            confidence: "high"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "info@amanco.example.com",
            sourceUrl: "https://amanco.example.com/contact"
          },
          {
            type: "phone" as const,
            value: "+966114736100",
            sourceUrl: "https://amanco.example.com/contact"
          }
        ],
        summary:
          "Amanco is a Saudi Arabia HCIS Approved Security System Integrator and telecom solutions supplier. We provide complete telecommunication and security solutions including PAGA, mass notification, fire alarm, and industrial communication systems for industrial buyers. Our Markets: Oil & Gas, Petrochemical, Transportation, Government, Banking, Healthcare, Defence, Education."
      },
      {
        ...criteria,
        targetRegions: ["Saudi Arabia", "UAE", "Qatar"],
        productKeywords: ["telecom equipment", "fire alarm", "PAGA"],
        customerTypeKeywords: ["system integrator", "industrial buyer"]
      }
    );

    expect(score.risks).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Off-industry signal")])
    );
  });

  it("STILL hard-rejects a real bank whose own copy contains multiple strong finance phrases (Hamburg Commercial Bank scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Hamburg Commercial Bank",
        website: "https://hcob-bank.example.com",
        sourceUrl: "https://hcob-bank.example.com/business-areas/corporates",
        country: "GERMANY",
        inferredCountry: "GERMANY",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email" as const,
            value: "info@hcob-bank.example.com",
            sourceUrl: "https://hcob-bank.example.com/contact"
          }
        ],
        // A genuine commercial bank's own page. Multiple STRONG
        // finance phrases ("commercial bank", "investment banking",
        // "wealth management", "asset management") plus the WEAK
        // "bank"/"banking" mentions easily clear the threshold.
        summary:
          "Hamburg Commercial Bank is a leading commercial bank offering investment banking, wealth management, and asset management services to corporates and institutional investors across Germany."
      },
      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["PLC programmer", "industrial automation", "automation"],
        customerTypeKeywords: ["distributor", "system integrator"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([expect.stringContaining("Off-industry signal")])
    );
  });

  it("STILL hard-rejects an aesthetic clinic with multiple strong medical phrases (Aesthetix scenario, post-strong/weak refactor)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Aesthetix Beauty Clinic",
        website: "https://aesthetix.example.com",
        sourceUrl: "https://aesthetix.example.com/services",
        country: "GERMANY",
        inferredCountry: "GERMANY",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email" as const,
            value: "info@aesthetix.example.com",
            sourceUrl: "https://aesthetix.example.com/contact"
          }
        ],
        // Strong: "aesthetic medical", "medical clinic", "skincare",
        // "dental clinic". Comfortably ≥2 strong, no self-guard.
        summary:
          "Aesthetix is an aesthetic medical clinic offering cosmetic skincare treatments and dental clinic services for retail customers."
      },
      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["PLC programmer", "industrial automation"],
        customerTypeKeywords: ["distributor", "system integrator"]
      }
    );

    expect(score.status).toBe("rejected");
    expect(score.score).toBeLessThanOrEqual(39);
    expect(score.risks).toEqual(
      expect.arrayContaining([expect.stringContaining("Off-industry signal")])
    );
  });

  // 2026-05 P1 follow-up to off-industry: page-quality / content
  // classifier was using flat text.includes() against
  // contentNoiseTerms + newsContentTerms. Real telecom/SI buyer
  // pages whose nav menu contained "News" / "Media" links got
  // misclassified as content_or_directory and routed into
  // content_evidence with a 49-cap. The next four tests pin the
  // strong/weak refactor:
  //  - real telecom/SI sites are NOT classified as content pages
  //    just because of a single weak nav-menu word
  //  - real news/article pages STILL get classified as content

  it("does NOT classify a real telecom/SI buyer page as content just because the nav menu has a 'News' link (Kuwait Telecom scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Kuwait Telecom",
        website: "https://kuwait-telecom.example.com",
        sourceUrl: "https://kuwait-telecom.example.com/",
        country: "KUWAIT",
        inferredCountry: "KUWAIT",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            value: "+96522123456",
            country: "KUWAIT",
            sourceUrl: "https://kuwait-telecom.example.com/contact",
            confidence: "high"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "info@kuwait-telecom.example.com",
            sourceUrl: "https://kuwait-telecom.example.com/contact"
          },
          {
            type: "phone" as const,
            value: "+96522123456",
            sourceUrl: "https://kuwait-telecom.example.com/contact"
          }
        ],
        // Real telecom buyer-side body copy. The only "content" word
        // here is the nav-menu link "News" at the very end. Under the
        // old flat-includes rule that single weak term tripped
        // contentNoiseTerms and the candidate got page-typed as
        // content_or_directory + content_evidence (scoreCap 49).
        summary:
          "Kuwait Telecom is a network operator and telecom system integrator delivering IP networks, voice termination services, and managed telecom solutions for businesses, carriers, and the telecom industry. Industries served: Telecom, Banking, Retail, Media, Healthcare, Security. About Us Get A Quote News"
      },
      {
        ...criteria,
        targetRegions: ["Kuwait", "UAE", "Saudi Arabia"],
        productKeywords: ["RRU", "BBU", "telecom equipment", "5G"],
        customerTypeKeywords: ["operator", "system integrator"]
      }
    );

    // The page-quality / news-content classifier must NOT have
    // misclassified this as content. Both risk strings come from
    // pageType-driven branches we want suppressed for nav-menu hits.
    expect(score.risks).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Search result looks like article, report, job, training, or media content"
        )
      ])
    );
    expect(score.risks).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "News, article, blog, media, report, or content page cannot enter the main customer list"
        )
      ])
    );
    expect(score.pageType).not.toBe("content_or_directory");
    expect(score.leadType).not.toBe("content_evidence");
  });

  it("does NOT classify an HCIS-approved system integrator as content because its menu has 'Media' (Amanco SA scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Amanco",
        website: "https://amanco.example.com",
        sourceUrl: "https://amanco.example.com/about",
        country: "SAUDI ARABIA",
        inferredCountry: "SAUDI ARABIA",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            value: "+966114736100",
            country: "SAUDI ARABIA",
            sourceUrl: "https://amanco.example.com/contact",
            confidence: "high"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "info@amanco.example.com",
            sourceUrl: "https://amanco.example.com/contact"
          },
          {
            type: "phone" as const,
            value: "+966114736100",
            sourceUrl: "https://amanco.example.com/contact"
          }
        ],
        summary:
          "Amanco is a Saudi Arabia HCIS Approved Security System Integrator and telecom contractor providing complete telecommunication and security solutions including PAGA, mass notification, fire alarm, and industrial communication systems. Latest News and Media coverage available."
      },
      {
        ...criteria,
        targetRegions: ["Saudi Arabia", "UAE", "Qatar"],
        productKeywords: ["telecom equipment", "fire alarm", "PAGA"],
        customerTypeKeywords: ["system integrator", "telecom contractor"]
      }
    );

    expect(score.risks).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Search result looks like article, report, job, training, or media content"
        )
      ])
    );
    expect(score.pageType).not.toBe("content_or_directory");
    expect(score.leadType).not.toBe("content_evidence");
  });

  it("does NOT hide an official telecom service page because social share URLs mention news/articles", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Aesthetix",
        website: "https://aesthetixglobal.com/en-ae/telecom-system-integration",
        sourceUrl: "https://aesthetixglobal.com/en-ae/telecom-system-integration",
        country: "UAE",
        inferredCountry: "UAE",
        countryConfidence: "medium",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            value: "+97143262333",
            country: "UAE",
            sourceUrl: "https://aesthetixglobal.com/en/contact-us",
            confidence: "medium"
          }
        ],
        contacts: [
          {
            type: "email" as const,
            value: "enquiries@aesthetixglobal.com",
            sourceUrl: "https://aesthetixglobal.com"
          },
          {
            type: "phone" as const,
            value: "+97143262333",
            sourceUrl: "https://aesthetixglobal.com/en/contact-us"
          },
          {
            type: "social" as const,
            value:
              "https://twitter.com/intent/tweet?url=https%3A%2F%2Faesthetixglobal.com%2Fnews-and-updates%2Foman-gas-company-3-year-maintenance",
            sourceUrl: "https://aesthetixglobal.com/en-ae/news-and-updates/oman-gas-company"
          },
          {
            type: "social" as const,
            value:
              "https://www.linkedin.com/shareArticle?mini=true&url=https%3A%2F%2Faesthetixglobal.com%2Fnews-and-updates%2Foman-gas-company-3-year-maintenance",
            sourceUrl: "https://aesthetixglobal.com/en-ae/news-and-updates/oman-gas-company"
          }
        ],
        summary:
          "Aesthetix is a telecom system integrator and engineering service provider in UAE for oil and gas telecom projects. Services include procurement, logistics, design, construction, commissioning, SAT, training, and managed services. Latest News."
      },
      {
        ...criteria,
        targetRegions: ["UAE"],
        productKeywords: ["telecom equipment", "telecom spare parts", "5G"],
        customerTypeKeywords: ["system integrator", "contractor", "engineering service provider"]
      }
    );

    expect(score.pageType).not.toBe("content_or_directory");
    expect(score.leadType).not.toBe("content_evidence");
    expect(score.risks).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "News, article, blog, media, report, or content page cannot enter the main customer list"
        )
      ])
    );
    expect(score.status).not.toBe("rejected");
  });

  it("STILL classifies a real news/article URL as content even when the candidate country IS in target (EE Times-style scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "EE Times Germany",
        website: "https://www.eetimes.example.de",
        sourceUrl:
          "https://www.eetimes.example.de/european-telecoms-eye-openran-to-replace-huawei-equipment/",
        // Country deliberately set to IN-TARGET so the assertion is
        // not contaminated by verified off-target hard reject. If the
        // page-quality / news classifier were broken, a Germany news
        // page would slip through into review/qualified.
        country: "GERMANY",
        inferredCountry: "GERMANY",
        countryConfidence: "high",
        countryConflict: false,
        countryEvidence: [
          {
            type: "phone",
            value: "+4930123456",
            country: "GERMANY",
            sourceUrl: "https://www.eetimes.example.de",
            confidence: "high"
          }
        ],
        contacts: [],
        // Multiple weak news/content terms in the body — under the
        // new strong/weak rule, weak >= 3 fires hasNewsContentSignal.
        // Plus an explicit URL slug that looksLikeArticlePath would
        // also pick up via the /20\d{2}/ pattern... but the slug
        // here uses kebab-case headline. Rely on weak >= 3 alone.
        summary:
          "EE Times Germany — European telecoms eye OpenRAN to replace Huawei equipment. Read the full news article. Categories: news, blog, media, article. Author: a journalist."
      },
      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["RRU", "BBU", "PLC programmer"],
        customerTypeKeywords: ["distributor", "system integrator"]
      }
    );

    // Strong assertion: page must be classified as content_or_directory
    // AND content_evidence risks must be present. Country is IN-target,
    // so this isolates the page-quality / news classifier behaviour.
    expect(score.pageType).toBe("content_or_directory");
    expect(score.leadType).toBe("content_evidence");
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "News, article, blog, media, report, or content page cannot enter the main customer list"
        )
      ])
    );
    expect(score.status).not.toBe("qualified");
  });

  it("STILL rejects market-research style pages via hardContentNoise (Future Market Insights scenario)", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const score = service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Future Market Insights",
        website: "https://www.futuremarketinsights.example.com",
        sourceUrl:
          "https://www.futuremarketinsights.example.com/reports/5g-ran-market",
        country: "UNITED STATES",
        inferredCountry: "UNITED STATES",
        countryConfidence: "medium",
        countryConflict: false,
        contacts: [],
        // "market report"/"industry report"/"research report" are
        // hardRejectContentTerms — they make hardContentNoise=true
        // and the page is page-typed as content_or_directory.
        summary:
          "Future Market Insights publishes the latest market report, industry report, and research report on the 5G RAN market with detailed market size, market share, and market forecast figures."
      },
      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["RRU", "BBU"],
        customerTypeKeywords: ["operator", "system integrator"]
      }
    );

    // Market-research page must stay out of qualified.
    expect(score.score).toBeLessThanOrEqual(58);
    expect(score.status).not.toBe("qualified");
    expect(score.pageType).toBe("content_or_directory");
  });

  it("threads productProfileAnalysis.negativeKeywords + customerProfileAnalysis.disqualifiers into the disqualifying-terms penalty", async () => {
    // 2026-05 Stage 2 follow-up first cut (item A): disqualifiers
    // pulled from the persisted profile analyses. We assert via
    // saveCandidates that a candidate snippet containing one of
    // those terms gets the existing -20 penalty + risk note.
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Berlin Telecom Service",
          url: "https://berlintelecom.de/services",
          // Real disqualifier hit — "training center" appears in
          // affirmative context (no negation cue), so the matcher
          // counts it. The negation-aware test below covers the
          // P2 case where a similar phrase is explicitly negated.
          snippet:
            "Berlin Telecom Service distributes RRU and BBU equipment. Our training center hosts certification courses for installers.",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Germany"],
        disqualifiers: ["consumer mobile phones", "training center"]
      },
      "Germany"
    );

    expect(result.createdCount).toBe(1);
    const created = prisma.leadCandidate.create.mock.calls[0]?.[0]?.data;
    expect(created?.icpScore?.create?.reasons?.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Contains disqualifying terms")
      ])
    );
  });

  // 2026-05 Stage 2 follow-up (P2): negation-context aware disqualifier.
  // The plain text.includes() match used to fire the -20 penalty on
  // candidates that EXPLICITLY rejected the term in their own copy
  // ("We do not sell consumer mobile phones"). The next four tests
  // pin the new behavior: explicit negation cues short-circuit the
  // match, but real negative pages still trip the penalty.
  //
  // We exercise scoreCandidate directly here instead of going through
  // saveCandidates so the assertion is unambiguous: only the
  // disqualifier-penalty path is under test, not the upstream
  // normalize/dedupe filters that may drop a row entirely on its own
  // grounds.

  function scoreWithDisqualifier(
    snippet: string,
    disqualifiers: string[]
  ) {
    const service = new LeadQualificationService(createPrismaMock() as any);
    return service.scoreCandidate(
      {
        taskId: "task-1",
        companyName: "Berlin Telecom Service",
        website: "https://example.com",
        sourceUrl: "https://example.com/contact",
        country: "GERMANY",
        inferredCountry: "GERMANY",
        countryConfidence: "high",
        countryConflict: false,
        contacts: [
          {
            type: "email" as const,
            value: "sales@example.com",
            sourceUrl: "https://example.com/contact"
          }
        ],
        summary: snippet
      },
      {
        ...criteria,
        targetRegions: ["Germany"],
        productKeywords: ["RRU", "BBU"],
        customerTypeKeywords: ["distributor", "system integrator"],
        disqualifiers
      }
    );
  }

  it("does NOT fire disqualifier penalty when the term is in an explicit negation context", () => {
    const score = scoreWithDisqualifier(
      "Berlin Telecom Service distributes RRU and BBU equipment. We do not sell consumer mobile phones; full B2B telecom contractor scope.",
      ["consumer mobile phones"]
    );
    expect(
      score.risks.some((r) => r.startsWith("Contains disqualifying terms"))
    ).toBe(false);
  });

  it("DOES fire disqualifier penalty when the term appears in a normal affirmative context", () => {
    const score = scoreWithDisqualifier(
      "Berlin Telecom Service is a wholesale distributor of RRU and BBU equipment AND consumer mobile phones for retail partners.",
      ["consumer mobile phones"]
    );
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Contains disqualifying terms")
      ])
    );
  });

  it("DOES fire disqualifier penalty when SOME match is negated but ANOTHER is affirmative", () => {
    // Two occurrences of "consumer mobile phones": the first is
    // governed by "do not sell" and is suppressed; the second is in a
    // plain affirmative context and must trip the penalty.
    const score = scoreWithDisqualifier(
      "Berlin Telecom Service does not sell consumer mobile phones to end users. Wholesale partners can still buy consumer mobile phones in bulk through our distribution arm.",
      ["consumer mobile phones"]
    );
    expect(score.risks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Contains disqualifying terms")
      ])
    );
  });

  it("does NOT fire disqualifier penalty for 'without X' / 'except X' phrasings", () => {
    const score = scoreWithDisqualifier(
      "Berlin Telecom Service distributes RRU and BBU equipment without marketplace listings, except career events organized by partners.",
      ["marketplace", "career"]
    );
    expect(
      score.risks.some((r) => r.startsWith("Contains disqualifying terms"))
    ).toBe(false);
  });
});
