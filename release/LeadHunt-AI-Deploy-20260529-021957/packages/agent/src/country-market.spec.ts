import { describe, expect, it } from "vitest";
import { countryToSearchApiCode, countryToSite, resolveCountry } from "./country-market.js";

describe("country market helpers", () => {
  it("resolves target markets used by lead-search prompts to country, site, and Brave codes", () => {
    const cases = [
      { input: "Nigeria", code: "NG", site: ".ng" },
      { input: "Kenya", code: "KE", site: ".ke" },
      { input: "Russia", code: "RU", site: ".ru" },
      { input: "Ukraine", code: "UA", site: ".ua" }
    ];

    for (const item of cases) {
      expect(resolveCountry(item.input)?.code).toBe(item.code);
      expect(countryToSite(item.input)).toBe(item.site);
      expect(countryToSearchApiCode(item.input)).toBe(item.code);
    }
  });
});
