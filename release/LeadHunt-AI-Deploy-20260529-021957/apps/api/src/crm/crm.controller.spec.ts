import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { CrmController } from "./crm.controller.js";

function requestWithCookie(): Request {
  return {
    headers: {
      cookie: "lh_session=session-1.token-1"
    }
  } as Request;
}

function createController() {
  const authService = {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "user-1",
        email: "owner@example.com"
      }
    })
  };
  const crmService = {
    listCustomers: vi.fn().mockResolvedValue({ companies: [], contacts: [] }),
    getAnalytics: vi.fn().mockResolvedValue({ range: "all" }),
    syncLead: vi.fn().mockResolvedValue({ ok: true }),
    getLead: vi.fn().mockResolvedValue({ ok: true, company: { id: "crm-1" } }),
    createLead: vi.fn().mockResolvedValue({ ok: true, company: { id: "crm-1" } }),
    updateLead: vi.fn().mockResolvedValue({ ok: true, company: { id: "crm-1" } })
  };

  return {
    controller: new CrmController(authService as any, crmService as any),
    authService,
    crmService
  };
}

describe("CrmController", () => {
  it("lists CRM leads for the current user", async () => {
    const { controller, crmService } = createController();

    await controller.list(requestWithCookie(), { view: "contacts", group: "uncontacted" });

    expect(crmService.listCustomers).toHaveBeenCalledWith("user-1", {
      view: "contacts",
      group: "uncontacted"
    });
  });

  it("syncs a lead to CRM for the current user", async () => {
    const { controller, crmService } = createController();

    const result = await controller.sync(requestWithCookie(), {
      leadId: "11111111-1111-4111-8111-111111111111",
      stage: "contacted",
      tags: ["已触达"]
    });

    expect(result).toEqual({ ok: true });
    expect(crmService.syncLead).toHaveBeenCalledWith("user-1", {
      leadId: "11111111-1111-4111-8111-111111111111",
      stage: "contacted",
      tags: ["已触达"]
    });
  });

  it("returns dashboard analytics for the current user", async () => {
    const { controller, crmService } = createController();

    const result = await controller.analytics(requestWithCookie(), { range: "week" });

    expect(result).toEqual({ range: "all" });
    expect(crmService.getAnalytics).toHaveBeenCalledWith("user-1", "week");
  });

  it("returns a CRM lead detail for the current user", async () => {
    const { controller, crmService } = createController();

    const result = await controller.getLead(requestWithCookie(), "11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({ ok: true, company: { id: "crm-1" } });
    expect(crmService.getLead).toHaveBeenCalledWith("user-1", "11111111-1111-4111-8111-111111111111");
  });

  it("creates a manual CRM lead for the current user", async () => {
    const { controller, crmService } = createController();

    await controller.createLead(requestWithCookie(), {
      companyName: "Manual Telecom LLC",
      website: "https://manual.example",
      country: "UAE",
      stage: "potential",
      tags: ["重点客户"],
      contacts: [{ type: "email", value: "sales@manual.example" }]
    });

    expect(crmService.createLead).toHaveBeenCalledWith("user-1", {
      companyName: "Manual Telecom LLC",
      website: "https://manual.example",
      country: "UAE",
      stage: "potential",
      tags: ["重点客户"],
      contacts: [{ type: "email", value: "sales@manual.example" }]
    });
  });

  it("updates a CRM lead for the current user", async () => {
    const { controller, crmService } = createController();

    await controller.updateLead(requestWithCookie(), "11111111-1111-4111-8111-111111111111", {
      stage: "interested",
      tags: ["感兴趣"]
    });

    expect(crmService.updateLead).toHaveBeenCalledWith("user-1", "11111111-1111-4111-8111-111111111111", {
      stage: "interested",
      tags: ["感兴趣"]
    });
  });

  it("rejects invalid list query values", async () => {
    const { controller, crmService } = createController();

    await expect(controller.list(requestWithCookie(), { view: "unknown" })).rejects.toThrow("Invalid CRM list query");
    expect(crmService.listCustomers).not.toHaveBeenCalled();
  });

  it("rejects invalid analytics query values", async () => {
    const { controller, crmService } = createController();

    await expect(controller.analytics(requestWithCookie(), { range: "forever" })).rejects.toThrow("Invalid CRM analytics query");
    expect(crmService.getAnalytics).not.toHaveBeenCalled();
  });

  it("rejects invalid CRM lead payloads", async () => {
    const { controller, crmService } = createController();

    await expect(controller.createLead(requestWithCookie(), { companyName: "" })).rejects.toThrow("Invalid CRM lead payload");
    await expect(controller.updateLead(requestWithCookie(), "not-a-uuid", { stage: "interested" })).rejects.toThrow(
      "Invalid CRM lead id"
    );
    expect(crmService.createLead).not.toHaveBeenCalled();
    expect(crmService.updateLead).not.toHaveBeenCalled();
  });
});
