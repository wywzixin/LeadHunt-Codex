import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerProfileService } from "./customer-profile.service.js";

function createPrismaMock() {
  return {
    customerProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    }
  };
}

describe("CustomerProfileService", () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: CustomerProfileService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new CustomerProfileService(prisma as any);
  });

  it("requires authentication when reading", async () => {
    await expect(service.get(null)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("saves a valid customer profile", async () => {
    prisma.customerProfile.upsert.mockResolvedValue({
      id: "profile-1",
      userId: "user-1"
    });

    const result = await service.save("user-1", {
      targetRegions: ["Middle East", "Africa"],
      referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"],
      notes: "Telecom distributors and project integrators"
    });

    expect(result.id).toBe("profile-1");
    expect(prisma.customerProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: expect.objectContaining({
        userId: "user-1",
        targetRegions: ["Middle East", "Africa"]
      }),
      update: expect.objectContaining({
        referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"]
      })
    });
  });

  it("rejects missing target regions", async () => {
    await expect(
      service.save("user-1", {
        targetRegions: [],
        referenceCustomerUrls: ["https://spectrummea.com/"]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects invalid reference customer URLs", async () => {
    await expect(
      service.save("user-1", {
        targetRegions: ["Middle East"],
        referenceCustomerUrls: ["not-a-url"]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stores multiple reference customers, CRM samples, and trimmed notes", async () => {
    prisma.customerProfile.upsert.mockResolvedValue({
      id: "profile-2",
      userId: "user-1"
    });

    await service.save("user-1", {
      targetRegions: ["  UAE  ", "Saudi Arabia"],
      referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"],
      crmSampleIds: ["crm-spectrum", "crm-highcloud"],
      notes: "  stockists and system integrators  "
    });

    expect(prisma.customerProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: expect.objectContaining({
        targetRegions: ["UAE", "Saudi Arabia"],
        referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"],
        crmSampleIds: ["crm-spectrum", "crm-highcloud"],
        notes: "stockists and system integrators"
      }),
      update: expect.objectContaining({
        targetRegions: ["UAE", "Saudi Arabia"],
        referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"],
        crmSampleIds: ["crm-spectrum", "crm-highcloud"],
        notes: "stockists and system integrators"
      })
    });
  });
});
