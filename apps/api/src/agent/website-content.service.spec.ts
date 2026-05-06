import { describe, expect, it, vi } from "vitest";
import { WebsiteContentService } from "./website-content.service.js";

function htmlResponse(url: string, html: string) {
  return {
    ok: true,
    status: 200,
    url,
    headers: {
      get: vi.fn().mockReturnValue("text/html; charset=utf-8")
    },
    text: vi.fn().mockResolvedValue(html)
  } as unknown as Response;
}

describe("WebsiteContentService", () => {
  it("reads website content and extracts product/customer evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      htmlResponse(
        "https://telecorenet.com/products",
        [
          "<title>Telecore products</title>",
          "Huawei WBBP and UMPT boards are available for telecom spare parts supply.",
          "Ericsson AIR radio units, ZTE R8882 RRU, BBU and Eltek rectifier modules support 5G network rollout."
        ].join(" ")
      )
    );
    const service = new WebsiteContentService(fetchImpl as unknown as typeof fetch);

    const result = await service.readProfileSites({
      productUrls: ["https://telecorenet.com/products"],
      referenceCustomerUrls: []
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://telecorenet.com/products/", expect.any(Object));
    expect(result.summary).toMatchObject({ attempted: 1, read: 1, failed: 0 });
    expect(result.productSites[0]).toMatchObject({
      status: "read",
      domain: "telecorenet.com",
      title: "Telecore products"
    });
    expect(result.productSites[0]?.extractedTerms.productTerms).toEqual(
      expect.arrayContaining(["5G telecom equipment", "remote radio unit", "baseband unit", "Eltek rectifier"])
    );
    expect(result.productSites[0]?.extractedTerms.brandTerms).toEqual(
      expect.arrayContaining(["Huawei", "ZTE", "Ericsson", "Eltek"])
    );
    expect(result.productSites[0]?.evidenceSnippets.length).toBeGreaterThan(0);
  });

  it("marks failed reads instead of pretending analysis succeeded", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network timeout"));
    const service = new WebsiteContentService(fetchImpl as unknown as typeof fetch);

    const result = await service.readProfileSites({
      productUrls: ["https://telecorenet.com/"],
      referenceCustomerUrls: ["https://spectrummea.com/"]
    });

    expect(result.summary).toEqual({ attempted: 2, read: 0, failed: 2 });
    expect(result.productSites[0]).toMatchObject({
      status: "failed",
      error: "network timeout",
      extractedTerms: {
        productTerms: [],
        customerIntentTerms: [],
        scenarioTerms: [],
        brandTerms: []
      }
    });
  });

  it("crawls paginated WooCommerce product names into product terms", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/products/page/2/")) {
        return Promise.resolve(
          htmlResponse(
            url,
            [
              '<p class="woocommerce-result-count">Showing 13&ndash;24 of 24 results</p>',
              '<h2 class="woocommerce-loop-product__title">Huawei RRU3959</h2>',
              '<h2 class="woocommerce-loop-product__title">ZTE BPN2</h2>'
            ].join(" ")
          )
        );
      }

      return Promise.resolve(
        htmlResponse(
          "https://telecorenet.com/products/",
          [
            '<p class="woocommerce-result-count">Showing 1&ndash;12 of 24 results</p>',
            '<a href="https://telecorenet.com/products/page/2/" class="page-numbers">2</a>',
            '<h2 class="woocommerce-loop-product__title">AAU5271 02311TPK</h2>',
            '<h2 class="woocommerce-loop-product__title">Eltek 241119.105MC</h2>'
          ].join(" ")
        )
      );
    });
    const service = new WebsiteContentService(fetchImpl as unknown as typeof fetch);

    const result = await service.readProfileSites({
      productUrls: ["https://telecorenet.com/products"],
      referenceCustomerUrls: []
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://telecorenet.com/products/", expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith("https://telecorenet.com/products/page/2/", expect.any(Object));
    expect(result.productSites[0]?.productNames).toEqual([
      "AAU5271 02311TPK",
      "Eltek 241119.105MC",
      "Huawei RRU3959",
      "ZTE BPN2"
    ]);
    expect(result.productSites[0]?.productCatalog).toMatchObject({
      totalProducts: 24,
      listedProducts: 4,
      pagesRead: 2,
      truncated: true
    });
    expect(result.productSites[0]?.extractedTerms.productTerms).toEqual(
      expect.arrayContaining(["AAU5271 02311TPK", "Huawei RRU3959", "ZTE BPN2"])
    );
  });
});
