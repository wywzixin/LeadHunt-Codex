import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("returns an ok health payload", () => {
    const result = new HealthController().check();

    expect(result.status).toBe("ok");
    expect(result.service).toBe("leadhunt-api");
    expect(result.timestamp).toEqual(expect.any(String));
    expect(result.uptime).toEqual(expect.any(Number));
  });
});
