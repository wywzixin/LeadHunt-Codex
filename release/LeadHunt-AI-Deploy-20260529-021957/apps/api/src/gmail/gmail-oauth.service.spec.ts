import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { GmailOAuthService, gmailScopes } from "./gmail-oauth.service.js";

function setGoogleEnv() {
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:4000/api/gmail/oauth/callback";
  process.env.SESSION_SECRET = "session-secret";
  process.env.TOKEN_ENCRYPTION_KEY = "token-secret";
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload))
  };
}

function createPrismaMock() {
  return {
    gmailAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(({ create }) =>
        Promise.resolve({
          id: "gmail-1",
          email: create.email,
          connectedAt: new Date("2026-04-29T00:00:00.000Z"),
          revokedAt: null,
          refreshTokenEncrypted: create.refreshTokenEncrypted
        })
      ),
      update: vi.fn().mockResolvedValue({})
    }
  };
}

describe("GmailOAuthService", () => {
  it("builds a Gmail OAuth URL with least needed V1 scopes", () => {
    setGoogleEnv();
    const service = new GmailOAuthService(createPrismaMock() as any, { fetchImpl: vi.fn() });

    const url = new URL(service.buildAuthorizationUrl("user-1"));

    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/api/gmail/oauth/callback"
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe(gmailScopes.join(" "));
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("exchanges code, fetches Gmail profile, and stores encrypted refresh token", async () => {
    setGoogleEnv();
    const prisma = createPrismaMock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer"
        })
      )
      .mockResolvedValueOnce(jsonResponse({ emailAddress: "WangYawei223@Gmail.com" }));
    const service = new GmailOAuthService(prisma as any, { fetchImpl });
    const state = service.buildAuthorizationUrl("user-1").split("state=")[1]!;

    const result = await service.handleCallback("code-1", decodeURIComponent(state));

    expect(result.account.email).toBe("wangyawei223@gmail.com");
    expect(prisma.gmailAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_email: {
            userId: "user-1",
            email: "wangyawei223@gmail.com"
          }
        },
        create: expect.objectContaining({
          userId: "user-1",
          email: "wangyawei223@gmail.com",
          refreshTokenEncrypted: expect.not.stringContaining("refresh-token")
        })
      })
    );
  });

  it("returns authorization status without exposing tokens", async () => {
    setGoogleEnv();
    const prisma = createPrismaMock();
    prisma.gmailAccount.findFirst.mockResolvedValue({
      id: "gmail-1",
      email: "user@gmail.com",
      connectedAt: new Date("2026-04-29T00:00:00.000Z"),
      revokedAt: null,
      refreshTokenEncrypted: "secret"
    });
    const service = new GmailOAuthService(prisma as any, { fetchImpl: vi.fn() });

    const result = await service.getAccount("user-1");

    expect(result.connected).toBe(true);
    expect(result.account).toEqual({
      id: "gmail-1",
      email: "user@gmail.com",
      connectedAt: new Date("2026-04-29T00:00:00.000Z"),
      revokedAt: null
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("marks an account revoked locally", async () => {
    setGoogleEnv();
    const prisma = createPrismaMock();
    prisma.gmailAccount.findFirst.mockResolvedValue({
      id: "gmail-1",
      email: "user@gmail.com",
      connectedAt: new Date("2026-04-29T00:00:00.000Z"),
      revokedAt: null,
      refreshTokenEncrypted: "invalid-ciphertext"
    });
    const service = new GmailOAuthService(prisma as any, { fetchImpl: vi.fn() });

    await expect(service.revokeAccount("user-1")).resolves.toEqual({ ok: true, revoked: true });
    expect(prisma.gmailAccount.update).toHaveBeenCalledWith({
      where: { id: "gmail-1" },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it("returns readable callback errors", async () => {
    setGoogleEnv();
    const service = new GmailOAuthService(createPrismaMock() as any, { fetchImpl: vi.fn() });

    await expect(service.handleCallback(undefined, "state")).rejects.toThrow(BadRequestException);
    await expect(service.handleCallback("code", "invalid-state")).rejects.toThrow(BadRequestException);
    await expect(service.handleCallback("code", "invalid-state")).rejects.toThrow("Invalid Gmail OAuth state");
  });
});
