import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductProfileService } from "./product-profile.service.js";

function createPrismaMock() {
  return {
    productProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    }
  };
}

describe("ProductProfileService", () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: ProductProfileService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ProductProfileService(prisma as any);
  });

  it("requires authentication when reading", async () => {
    await expect(service.get(null)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("saves a valid product profile", async () => {
    prisma.productProfile.upsert.mockResolvedValue({
      id: "profile-1",
      userId: "user-1",
      websiteUrl: "https://telecorenet.com/"
    });

    const result = await service.save("user-1", {
      websiteUrl: "https://telecorenet.com/",
      productPageUrl: "https://telecorenet.com/products",
      documentUrls: ["https://telecorenet.com/catalog.pdf"],
      notes: "Huawei/ZTE spare parts"
    });

    expect(result.id).toBe("profile-1");
    expect(prisma.productProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: expect.objectContaining({
        userId: "user-1",
        websiteUrl: "https://telecorenet.com/"
      }),
      update: expect.objectContaining({
        productPageUrl: "https://telecorenet.com/products"
      })
    });
  });

  it("rejects invalid product profile URLs", async () => {
    await expect(
      service.save("user-1", {
        websiteUrl: "not-a-url"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a missing website URL", async () => {
    await expect(
      service.save("user-1", {
        notes: "Huawei/ZTE spare parts"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stores multiple document URLs and trims notes", async () => {
    prisma.productProfile.upsert.mockResolvedValue({
      id: "profile-2",
      userId: "user-1"
    });

    await service.save("user-1", {
      websiteUrl: "https://telecorenet.com/",
      productPageUrl: "",
      documentUrls: [
        "https://telecorenet.com/catalog.pdf",
        "https://telecorenet.com/stock-list.pdf"
      ],
      notes: "  telecom spare parts  "
    });

    expect(prisma.productProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: expect.objectContaining({
        documentUrls: [
          "https://telecorenet.com/catalog.pdf",
          "https://telecorenet.com/stock-list.pdf"
        ],
        notes: "telecom spare parts",
        productPageUrl: null
      }),
      update: expect.objectContaining({
        documentUrls: [
          "https://telecorenet.com/catalog.pdf",
          "https://telecorenet.com/stock-list.pdf"
        ],
        notes: "telecom spare parts",
        productPageUrl: null
      })
    });
  });
});
