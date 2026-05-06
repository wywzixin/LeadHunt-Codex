import { describe, expect, it, vi } from "vitest";
import { SearchStrategyService } from "./search-strategy.service.js";

function createPrismaMock() {
  return {
    searchQuery: {
      createMany: vi.fn().mockResolvedValue({ count: 15 })
    }
  };
}

describe("SearchStrategyService", () => {
  it("plans executable Brave search queries", () => {
    const service = new SearchStrategyService(createPrismaMock() as any);
    const queries = service.planQueries({
      targetMarkets: ["UAE", "Saudi Arabia"],
      minQueryCount: 15
    });

    expect(queries).toHaveLength(15);
    expect(queries).not.toContainEqual(expect.objectContaining({ executionStatus: "manual_only" }));
    expect(queries).not.toContainEqual(expect.objectContaining({ executionStatus: "disabled" }));
  });

  it("maps generated strategies into search_queries records", async () => {
    const prisma = createPrismaMock();
    const service = new SearchStrategyService(prisma as any);

    const result = await service.savePlannedQueries("task-1", {
      targetMarkets: ["UAE"],
      minQueryCount: 15
    });

    expect(result.count).toBe(15);
    expect(prisma.searchQuery.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          provider: "brave",
          operatorSource: expect.any(String),
          executionStatus: "planned",
          operatorName: expect.any(String),
          strategyTemplate: expect.any(String),
          keywordGroups: expect.objectContaining({
            productTerms: expect.arrayContaining(["telecom equipment"])
          }),
          effectivenessScore: expect.any(Number)
        })
      ])
    });
  });
});
