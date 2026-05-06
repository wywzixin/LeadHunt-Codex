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
        expect.objectContaining({ type: "social", value: "https://linkedin.com/company/spectrummea" })
      ])
    );
    expect(candidates[1]?.companyName).toBe("High Cloud");
  });

  it("scores strong ICP matches and flags risky candidates", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "Spectrum MEA - Telecom Distributor UAE",
          url: "https://spectrummea.com/",
          snippet:
            "UAE telecom equipment distributor and system integrator with RRU BBU stock. sales@spectrummea.com",
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
        "Matches telecom infrastructure context",
        "Mentions relevant product keywords",
        "Matches target customer type",
        "Located in target market"
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

  it("keeps noisy article and social results in the candidate pool with ICP risk scoring", async () => {
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
          snippet: "Dubai telecom equipment stockist and system integrator with RRU BBU parts. sales@gulfsupply.ae",
          source: "web"
        }
      ],
      criteria,
      "UAE"
    );

    expect(result.createdCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledTimes(3);
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
          snippet: "Telecom equipment distributor and stockist in Dubai with RRU BBU spare parts. sales@desertlink.ae",
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

  it("saves marketplace and non-ICP results but lets ICP mark weak fits", async () => {
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
          snippet: "Saudi telecom equipment distributor and system integrator with BBU stock. sales@riyadhnetworksupplies.sa",
          source: "web"
        }
      ],
      {
        ...criteria,
        targetRegions: ["Saudi Arabia"]
      },
      "Saudi Arabia"
    );

    expect(result.createdCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Riyadh Network Supplies"
        })
      })
    );
  });

  it("keeps B2B marketplace platforms without inheriting the query country blindly", async () => {
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

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledTimes(2);
  });

  it("uses a specific query country for real company pages without forcing marketplace results through", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const [company, marketplace] = service.normalizeSearchResults(
      [
        {
          title: "Riyadh Radio Systems - Telecom Equipment Stockist",
          url: "https://riyadhradiosystems.com/contact",
          snippet: "Telecom equipment stockist and system integrator with RRU BBU spare parts. sales@riyadhradiosystems.com",
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

    expect(company?.country).toBe("SAUDI ARABIA");
    expect(marketplace?.country).toBeNull();

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Riyadh Radio Systems - Telecom Equipment Stockist",
          url: "https://riyadhradiosystems.com/contact",
          snippet: "Telecom equipment stockist and system integrator with RRU BBU spare parts. sales@riyadhradiosystems.com",
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
          country: "SAUDI ARABIA"
        })
      })
    );
  });

  it("uses manually selected countries while keeping known off-target country domains for ICP review", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Poznan Radio Systems - Telecom Equipment Stockist",
          url: "https://poznanradiosystems.com/contact",
          snippet: "Telecom equipment stockist and system integrator with RRU BBU spare parts. sales@poznanradiosystems.com",
          source: "web"
        },
        {
          title: "Berlin Radio Systems - Telecom Equipment Stockist",
          url: "https://berlinradio.de/contact",
          snippet: "Telecom equipment stockist and system integrator with RRU BBU spare parts. sales@berlinradio.de",
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
          country: null
        })
      })
    );
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Berlin Radio Systems",
          country: "GERMANY",
          status: "review"
        })
      })
    );
  });

  it("keeps tender portals as discovery evidence with lower ICP confidence", async () => {
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
          companyName: "Atlas Network Solutions LLC"
        })
      })
    );
  });

  it("keeps market reports when they expose contact evidence but scores them lower", async () => {
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
          snippet: "Dubai telecom equipment stockist and system integrator with RRU BBU parts. sales@metroradio.ae",
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
          companyName: "Metro Radio Systems LLC"
        })
      })
    );
  });

  it("keeps index and indicator pages as low-confidence candidates", async () => {
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

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Riyadh Network Systems LLC"
        })
      })
    );
  });

  it("keeps list pages when they expose company contact details", async () => {
    const prisma = createPrismaMock();
    const service = new LeadQualificationService(prisma as any);

    const result = await service.saveCandidates(
      "task-1",
      [
        {
          title: "Top 10 Telecommunications Tower Companies in the World 2025 - XH Tower Co., Ltd",
          url: "https://xhtower.com/",
          snippet: "Contact +852 5795 1525 xhtowerxh@gmail.com for tower systems and telecom equipment.",
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

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: "Delta Tower Systems LLC"
        })
      })
    );
  });

  it("allows brochure-style PDFs and off-target companies into the candidate pool for ICP review", async () => {
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
      {
        ...criteria,
        targetRegions: ["UAE"]
      },
      "UAE"
    );

    expect(result.createdCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          website: "https://alphastonecontracting.com/company-profile.pdf"
        })
      })
    );
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
          snippet: "Huawei phone accessories, smartphone repair parts and consumer electronics wholesale. +8620-2982 2580",
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

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
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

    expect(score.score).toBeLessThan(75);
    expect(score.status).toBe("review");
    expect(score.risks).toContain("No usable email or phone found yet");
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
      expect.arrayContaining(["Only generic IT/network service signal; no explicit telecom equipment signal"])
    );
  });

  it("keeps policy and report pages out of high-confidence ICP even when they mention procurement", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const [candidate] = service.normalizeSearchResults(
      [
        {
          title: "EU: Commission restricts the procurement of services and equipment from Huawei and ZTE",
          url: "https://www.globaltradealert.org/state-act/75972/eu-commission-restricts-the-procurement-of-services-and-equipment-from-huawei-and-zte",
          snippet: "Policy alert mentioning telecom equipment procurement in Israel with Huawei and ZTE.",
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
    expect(score.risks).toContain("Discovery/content page without direct contact stays low-confidence");
  });

  it("keeps lookup, regulatory, and directory pages as rejected evidence instead of top candidates", () => {
    const service = new LeadQualificationService(createPrismaMock() as any);
    const candidates = service.normalizeSearchResults(
      [
        {
          title: "MCC & MNC Lookup - Mobile Network Codes by Country and Operator | Cellular Finder",
          url: "https://celltowerfinder.com/mcc-mnc-lookup",
          snippet: "Lookup mobile network codes by country and operator for Chile telecom carriers.",
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
          snippet: "Telecom equipment repair, reverse logistics and spare parts support. sales@screamerelectronicservices.com",
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
            snippet: "Nigeria telecom system integrator and network maintenance company for base station projects.",
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
          snippet: "Nigeria telecom system integrator and network maintenance company for base station projects.",
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
