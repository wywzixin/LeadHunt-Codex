import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import { GmailController } from "./gmail.controller.js";

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
        email: "buyer@example.com"
      }
    })
  };
  const gmailOAuthService = {
    buildAuthorizationUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth"),
    handleCallback: vi.fn().mockResolvedValue({ account: { email: "user@gmail.com" } }),
    getAccount: vi.fn().mockResolvedValue({ connected: false, account: null }),
    revokeAccount: vi.fn().mockResolvedValue({ ok: true, revoked: true })
  };
  const gmailMessageService = {
    createDraft: vi.fn().mockResolvedValue({ ok: true, providerDraftId: "draft-1" }),
    sendEmail: vi.fn().mockResolvedValue({ ok: true, providerMessageId: "message-1" }),
    syncReplies: vi.fn().mockResolvedValue({ ok: true, newReplies: 1, classifiedReplies: 1 })
  };
  const leadHuntAiService = {
    rewriteEmail: vi.fn().mockResolvedValue({
      subject: "Updated subject",
      body: "Updated body",
      changes: ["Shortened opening"]
    })
  };

  return {
    controller: new GmailController(
      authService as any,
      gmailOAuthService as any,
      gmailMessageService as any,
      leadHuntAiService as any
    ),
    authService,
    gmailOAuthService,
    gmailMessageService,
    leadHuntAiService
  };
}

describe("GmailController", () => {
  it("returns an OAuth start URL for the current user", async () => {
    const { controller, gmailOAuthService } = createController();

    const result = await controller.start(requestWithCookie());

    expect(result.url).toContain("accounts.google.com");
    expect(gmailOAuthService.buildAuthorizationUrl).toHaveBeenCalledWith("user-1");
  });

  it("handles Google callback and redirects to mailbox", async () => {
    process.env.FRONTEND_URL = "http://localhost:3000";
    const { controller, gmailOAuthService } = createController();

    const result = await controller.callback("code", "state");

    expect(gmailOAuthService.handleCallback).toHaveBeenCalledWith("code", "state");
    expect(result).toEqual({
      url: "http://localhost:3000/mailbox?gmail=connected",
      statusCode: 302
    });
  });

  it("redirects expired Google callback state back to mailbox", async () => {
    process.env.FRONTEND_URL = "http://localhost:3000";
    const { controller, gmailOAuthService } = createController();
    gmailOAuthService.handleCallback.mockRejectedValueOnce(new BadRequestException("Expired Gmail OAuth state"));

    const result = await controller.callback("code", "state");

    expect(gmailOAuthService.handleCallback).toHaveBeenCalledWith("code", "state");
    expect(result).toEqual({
      url: "http://localhost:3000/mailbox?gmail=error&reason=expired",
      statusCode: 302
    });
  });

  it("returns account status and revokes account", async () => {
    const { controller, gmailOAuthService } = createController();

    await controller.account(requestWithCookie());
    await controller.deleteAccount(requestWithCookie());

    expect(gmailOAuthService.getAccount).toHaveBeenCalledWith("user-1");
    expect(gmailOAuthService.revokeAccount).toHaveBeenCalledWith("user-1");
  });

  it("creates a Gmail draft for the current user", async () => {
    const { controller, gmailMessageService } = createController();

    const result = await controller.createDraft(requestWithCookie(), {
      to: "prospect@example.com",
      replyTo: "buyer@example.com",
      subject: "Telecom equipment availability",
      body: "Hello"
    });

    expect(result).toEqual({ ok: true, providerDraftId: "draft-1" });
    expect(gmailMessageService.createDraft).toHaveBeenCalledWith("user-1", {
      to: "prospect@example.com",
      replyTo: "buyer@example.com",
      subject: "Telecom equipment availability",
      body: "Hello"
    });
  });

  it("requires explicit confirmation before sending", async () => {
    const { controller, gmailMessageService } = createController();

    await expect(
      controller.send(requestWithCookie(), {
        to: "prospect@example.com",
        subject: "Telecom equipment availability",
        body: "Hello",
        confirm: false
      })
    ).rejects.toThrow("Invalid Gmail request payload");
    expect(gmailMessageService.sendEmail).not.toHaveBeenCalled();
  });

  it("sends a confirmed Gmail message", async () => {
    const { controller, gmailMessageService } = createController();

    const result = await controller.send(requestWithCookie(), {
      to: "prospect@example.com",
      subject: "Telecom equipment availability",
      body: "Hello",
      confirm: true
    });

    expect(result).toEqual({ ok: true, providerMessageId: "message-1" });
    expect(gmailMessageService.sendEmail).toHaveBeenCalledWith("user-1", {
      to: "prospect@example.com",
      subject: "Telecom equipment availability",
      body: "Hello",
      confirm: true
    });
  });

  it("rewrites an email through the AI service", async () => {
    const { controller, leadHuntAiService } = createController();

    const result = await controller.rewrite(requestWithCookie(), {
      subject: "Hello",
      body: "Original body",
      outputLanguage: "English",
      tone: "Professional",
      instruction: "Make it shorter"
    });

    expect(result.body).toBe("Updated body");
    expect(leadHuntAiService.rewriteEmail).toHaveBeenCalledWith({
      subject: "Hello",
      body: "Original body",
      outputLanguage: "English",
      tone: "Professional",
      instruction: "Make it shorter"
    });
  });

  it("syncs Gmail replies for the current user", async () => {
    const { controller, gmailMessageService } = createController();

    const result = await controller.sync(requestWithCookie(), { threadId: "thread-1" });

    expect(result).toEqual({ ok: true, newReplies: 1, classifiedReplies: 1 });
    expect(gmailMessageService.syncReplies).toHaveBeenCalledWith("user-1", { threadId: "thread-1" });
  });
});
