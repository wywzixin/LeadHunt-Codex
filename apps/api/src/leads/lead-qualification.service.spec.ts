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
        }
      ],
      { taskId: "task-1" }
    );

    expect(candidates.map((candidate) => candidate.companyName)).toEqual([
      "SFPS",
      "TelephonyME",
      "STC"
    ]);
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
        risks: ["Needs manual review\u0000"]
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

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(prisma.leadCandidate.create).toHaveBeenCalledTimes(1);
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

    expect(fetchSpy).toHaveBeenCalled();
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

  it("keeps generic service pages out of the main lead path until direct contact evidence exists", async () => {
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
      ([input]) => input.data.website === "https://atlasnetwork.ae/services"
    );
    expect(atlasCall?.[0].data.status).toBe("evidence_review");
    expect(atlasCall?.[0].data.icpScore.create.score).toBeLessThan(50);
    const gulfCall = prisma.leadCandidate.create.mock.calls.find(
      ([input]) => input.data.website === "https://gulffieldtelecom.ae/contact"
    );
    expect(gulfCall?.[0].data.status).not.toBe("evidence_review");
    expect(gulfCall?.[0].data.icpScore.create.score).toBeGreaterThanOrEqual(50);
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

  it("uses manually selected countries while keeping known off-target country domains as rejected evidence", async () => {
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
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Berlin Radio Systems",
          country: "GERMANY",
          queryCountry: "POLAND",
          countryConflict: false,
          status: "country_conflict_review"
        })
      })
    );
  });

  it("flags official non-target countries instead of letting the query country disguise them", async () => {
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
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Tempest Network Solutions",
          queryCountry: "KENYA",
          country: "UNITED STATES",
          inferredCountry: "UNITED STATES",
          countryConflict: false,
          status: "country_conflict_review"
        })
      })
    );
    const reasons = prisma.leadCandidate.create.mock.calls[0]?.[0].data.icpScore.create.reasons;
    expect(reasons).toEqual(
      expect.objectContaining({
        countryValidation: expect.objectContaining({
          queryCountry: "KENYA",
          inferredCountry: "UNITED STATES",
          countryConflict: false
        })
      })
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
    expect(createdLead.status).not.toBe("country_conflict_review");
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
    expect(usScore.status).toBe("country_conflict_review");
    expect(usScore.risks).toContain(
      "Verified candidate country is outside the selected target markets; kept for country-conflict review"
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
          status: "intelligence_review",
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
          status: "intelligence_review"
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

  it("keeps contactless candidates out of high-confidence qualified status", () => {
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

    expect(score.score).toBeLessThan(50);
    expect(score.status).toBe("evidence_review");
    expect(score.risks).toContain("No usable email or phone found yet");
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

  it("keeps DAS, small-cell, private-network, and tower engineering firms for review", () => {
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

    expect(scores.map((score) => score.status)).toEqual(["review", "review", "review"]);
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
    expect(scores[1]?.status).toBe("evidence_review");
    expect(scores[1]?.leadType).toBe("government_information");
    expect(scores[2]?.status).toBe("rejected");
    expect(scores[3]?.score).toBeGreaterThan(scores[0]?.score ?? 0);
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

    expect(candidate?.contacts).toEqual([
      expect.objectContaining({ type: "phone", value: "+971 52 266 9803" })
    ]);
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
            <span>Phone: 0086-13735565568</span>
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
              expect.objectContaining({ type: "phone", value: "0086-13735565568" })
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
      status: "evidence_review"
    });
    expect(governmentCreate.icpScore.create.score).toBeLessThanOrEqual(49);
    expect(governmentCreate.icpScore.create.reasons).toMatchObject({
      leadType: "government_information",
      intelligenceType: null
    });
  });

  it("keeps RCR Wireless project news as intelligence instead of a main customer", async () => {
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

    expect(result.createdCount).toBe(1);
    const createData = prisma.leadCandidate.create.mock.calls[0]?.[0].data;
    expect(createData.status).toBe("intelligence_review");
    expect(createData.icpScore.create.score).toBeLessThanOrEqual(49);
    expect(createData.icpScore.create.reasons).toMatchObject({
      leadType: "intelligence",
      intelligenceType: "project_news",
      extractableCompanies: expect.arrayContaining(["ADNOC", "e&", "Nokia"])
    });
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
      "intelligence_review",
      "intelligence_review"
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
      "intelligence_review",
      "intelligence_review"
    ]);
    expect(scores.map((score) => score.intelligenceType)).toEqual([
      "project_news",
      "exhibition_pdf"
    ]);
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

  it("caps generic service pages without direct contacts below qualified", () => {
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

    expect(score.score).toBeLessThanOrEqual(58);
    expect(score.status).toBe("evidence_review");
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
});
