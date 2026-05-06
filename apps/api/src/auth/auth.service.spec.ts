import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { AuthService } from "./auth.service.js";

function createPrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    authAccount: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    userSession: {
      create: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn()
    },
    passwordResetToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    }
  };
}

describe("AuthService", () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: AuthService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AuthService(prisma as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers a new user and creates a session", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: "user-1",
      email: "buyer@example.com",
      name: "Buyer",
      role: "user",
      status: "active"
    });
    prisma.userSession.create.mockResolvedValue({
      id: "session-1"
    });

    const result = await service.register({
      email: " Buyer@Example.com ",
      password: "secure-password",
      name: "Buyer"
    });

    expect(result.user.email).toBe("buyer@example.com");
    expect(result.session.sessionId).toBe("session-1");
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "buyer@example.com",
          authAccounts: {
            create: {
              provider: "credentials",
              providerUserId: "buyer@example.com",
              email: "buyer@example.com"
            }
          }
        })
      })
    );
  });

  it("rejects duplicate registration emails", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user-1" });

    await expect(
      service.register({
        email: "buyer@example.com",
        password: "secure-password"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects short registration passwords", async () => {
    await expect(
      service.register({
        email: "buyer@example.com",
        password: "short"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("logs in an active user with a valid password", async () => {
    const passwordHash = await bcrypt.hash("secure-password", 4);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "buyer@example.com",
      name: null,
      role: "user",
      status: "active",
      passwordHash
    });
    prisma.user.update.mockResolvedValue({});
    prisma.userSession.create.mockResolvedValue({ id: "session-1" });

    const result = await service.login({
      email: "buyer@example.com",
      password: "secure-password"
    });

    expect(result.user.id).toBe("user-1");
    expect(result.session.sessionId).toBe("session-1");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLoginAt: expect.any(Date) }
    });
  });

  it("rejects login with a wrong password", async () => {
    const passwordHash = await bcrypt.hash("secure-password", 4);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "buyer@example.com",
      status: "active",
      passwordHash
    });

    await expect(
      service.login({
        email: "buyer@example.com",
        password: "wrong-password"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("requires a valid session for me", async () => {
    await expect(service.me(null)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("returns the current user for a valid session", async () => {
    prisma.userSession.findFirst.mockResolvedValue({
      id: "session-1",
      user: {
        id: "user-1",
        email: "buyer@example.com",
        name: "Buyer",
        role: "user",
        status: "active"
      }
    });

    const result = await service.me({
      sessionId: "session-1",
      token: "session-token"
    });

    expect(result.user.email).toBe("buyer@example.com");
    expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        refreshTokenHash: expect.any(String),
        expiresAt: {
          gt: expect.any(Date)
        }
      },
      include: {
        user: true
      }
    });
  });

  it("deletes the current session on logout", async () => {
    prisma.userSession.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      service.logout({
        sessionId: "session-1",
        token: "session-token"
      })
    ).resolves.toEqual({ ok: true });

    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        refreshTokenHash: expect.any(String)
      }
    });
  });

  it("stores password reset tokens only when the user exists", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.requestPasswordReset({ email: "missing@example.com" })
    ).resolves.toMatchObject({ ok: true });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValueOnce({ id: "user-1" });
    await service.requestPasswordReset({ email: "buyer@example.com" });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date)
      })
    });
  });

  it("resets a password with a valid reset token and clears active sessions", async () => {
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: "reset-1",
      userId: "user-1"
    });
    prisma.user.update.mockResolvedValue({});
    prisma.passwordResetToken.update.mockResolvedValue({});
    prisma.userSession.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      service.resetPassword({
        token: "valid-reset-token-value",
        password: "new-secure-password"
      })
    ).resolves.toEqual({ ok: true });

    expect(prisma.passwordResetToken.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.any(String),
        usedAt: null,
        expiresAt: {
          gt: expect.any(Date)
        }
      }
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: expect.any(String) }
    });
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: "reset-1" },
      data: { usedAt: expect.any(Date) }
    });
    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" }
    });
  });

  it("rejects invalid or expired reset tokens", async () => {
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        token: "expired-reset-token-value",
        password: "new-secure-password"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("builds a Google login URL with identity-only scopes", () => {
    vi.stubEnv("GOOGLE_AUTH_CLIENT_ID", "google-auth-client-id");
    vi.stubEnv("GOOGLE_AUTH_CLIENT_SECRET", "google-auth-client-secret");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "http://localhost:4000/api/auth/google/callback");

    const result = service.buildGoogleAuthorizationUrl("state-token-value-123");
    const url = new URL(result.url);

    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("google-auth-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4000/api/auth/google/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("scope")).not.toContain("gmail");
    expect(url.searchParams.get("state")).toBe("state-token-value-123");
    expect(result.maxAgeSeconds).toBe(600);
  });

  it("logs in an existing Google account from the OAuth callback", async () => {
    vi.stubEnv("GOOGLE_AUTH_CLIENT_ID", "google-auth-client-id");
    vi.stubEnv("GOOGLE_AUTH_CLIENT_SECRET", "google-auth-client-secret");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "http://localhost:4000/api/auth/google/callback");
    (service as any).fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "google-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: "google-user-1",
            email: "Buyer@Example.com",
            email_verified: true,
            name: "Google Buyer"
          }),
          { status: 200 }
        )
      );
    prisma.authAccount.findUnique.mockResolvedValue({
      id: "auth-account-1",
      user: {
        id: "user-1",
        email: "buyer@example.com",
        name: "Buyer",
        role: "user",
        status: "active"
      }
    });
    prisma.user.update.mockResolvedValue({});
    prisma.userSession.create.mockResolvedValue({ id: "session-1" });

    const result = await service.loginWithGoogleCallback(
      { code: "google-code", state: "state-token-value-123" },
      "state-token-value-123"
    );

    expect(result.user.email).toBe("buyer@example.com");
    expect(result.session.sessionId).toBe("session-1");
    expect(prisma.authAccount.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerUserId: {
          provider: "google",
          providerUserId: "google-user-1"
        }
      },
      include: {
        user: true
      }
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLoginAt: expect.any(Date) }
    });
  });

  it("links Google login to an existing email user", async () => {
    vi.stubEnv("GOOGLE_AUTH_CLIENT_ID", "google-auth-client-id");
    vi.stubEnv("GOOGLE_AUTH_CLIENT_SECRET", "google-auth-client-secret");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "http://localhost:4000/api/auth/google/callback");
    (service as any).fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "google-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: "google-user-2",
            email: "buyer@example.com",
            email_verified: true,
            name: "Google Buyer"
          }),
          { status: 200 }
        )
      );
    prisma.authAccount.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "buyer@example.com",
      name: null,
      role: "user",
      status: "active",
      emailVerifiedAt: null
    });
    prisma.authAccount.create.mockResolvedValue({ id: "auth-account-1" });
    prisma.user.update.mockResolvedValue({});
    prisma.userSession.create.mockResolvedValue({ id: "session-1" });

    const result = await service.loginWithGoogleCallback(
      { code: "google-code", state: "state-token-value-123" },
      "state-token-value-123"
    );

    expect(result.user.name).toBe("Google Buyer");
    expect(prisma.authAccount.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        provider: "google",
        providerUserId: "google-user-2",
        email: "buyer@example.com"
      }
    });
  });

  it("rejects a Google callback with an invalid state", async () => {
    await expect(
      service.loginWithGoogleCallback({ code: "google-code", state: "state-token-value-123" }, "different-state")
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
