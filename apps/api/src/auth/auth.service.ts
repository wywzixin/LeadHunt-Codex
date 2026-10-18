import { randomBytes, createHash } from "node:crypto";
import { BadRequestException, Injectable, UnauthorizedException, Inject } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createGmailFetchImpl, type GmailFetchLike } from "../gmail/gmail-fetch.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthPayload, AuthUser } from "./auth.types.js";
import type { SessionCookie } from "./session-cookie.js";

const sessionTtlDays = 30;
export const sessionMaxAgeSeconds = sessionTtlDays * 24 * 60 * 60;

const emailField = z.preprocess((value) => {
  return typeof value === "string" ? value.trim() : value;
}, z.string().email());

const registerSchema = z.object({
  email: emailField,
  password: z.string().min(8),
  name: z.string().trim().min(1).max(80).optional()
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1)
});

const passwordResetSchema = z.object({
  email: emailField
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(16),
  password: z.string().min(8)
});

const googleCallbackSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(16)
});

type GoogleTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfoResponse = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  error?: string;
  error_description?: string;
};

type DbUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  emailVerifiedAt?: Date | null;
};

@Injectable()
export class AuthService {
  private fetchImpl: GmailFetchLike = createGmailFetchImpl();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async register(input: unknown): Promise<AuthPayload & { session: SessionCookie }> {
    const data = parseOrBadRequest(registerSchema, input);
    const email = normalizeEmail(data.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new BadRequestException("Email is already registered");
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: data.name ?? null,
        passwordHash,
        authAccounts: {
          create: {
            provider: "credentials",
            providerUserId: email,
            email
          }
        }
      }
    });
    const session = await this.createSession(user.id);

    return {
      user: toAuthUser(user),
      session
    };
  }

  async login(input: unknown): Promise<AuthPayload & { session: SessionCookie }> {
    const data = parseOrBadRequest(loginSchema, input);
    const email = normalizeEmail(data.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordMatches = await bcrypt.compare(data.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    const session = await this.createSession(user.id);

    return {
      user: toAuthUser(user),
      session
    };
  }

  async me(session: SessionCookie | null): Promise<AuthPayload> {
    const user = await this.getUserFromSession(session);
    return { user };
  }

  async logout(session: SessionCookie | null) {
    if (!session) {
      return { ok: true };
    }

    await this.prisma.userSession.deleteMany({
      where: {
        id: session.sessionId,
        refreshTokenHash: hashToken(session.token)
      }
    });

    return { ok: true };
  }

  async requestPasswordReset(input: unknown) {
    const data = parseOrBadRequest(passwordResetSchema, input);
    const email = normalizeEmail(data.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      const token = randomToken();
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: addMinutes(new Date(), 30)
        }
      });
    }

    return {
      ok: true,
      message: "If the email exists, a password reset instruction has been prepared."
    };
  }

  async resetPassword(input: unknown) {
    const data = parseOrBadRequest(resetPasswordSchema, input);
    const record = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: hashToken(data.token),
        usedAt: null,
        expiresAt: {
          gt: new Date()
        }
      }
    });

    if (!record) {
      throw new BadRequestException("Invalid or expired reset token");
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash }
    });
    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    });
    await this.prisma.userSession.deleteMany({
      where: { userId: record.userId }
    });

    return { ok: true };
  }

  buildGoogleAuthorizationUrl(state = randomToken()) {
    const config = getGoogleAuthConfig();
    const url = new URL(config.authUri);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");

    return {
      url: url.toString(),
      state,
      maxAgeSeconds: 10 * 60
    };
  }

  async loginWithGoogleCallback(
    input: unknown,
    expectedState: string | null
  ): Promise<AuthPayload & { session: SessionCookie }> {
    const data = parseOrBadRequest(googleCallbackSchema, input);
    if (!expectedState || data.state !== expectedState) {
      throw new UnauthorizedException("Invalid Google OAuth state");
    }

    const config = getGoogleAuthConfig();
    const token = await this.exchangeGoogleCode(config, data.code);
    const profile = await this.fetchGoogleProfile(config, token.access_token);
    const email = normalizeEmail(profile.email);
    const providerUserId = profile.sub;

    const existingAccount = await this.prisma.authAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: "google",
          providerUserId
        }
      },
      include: {
        user: true
      }
    });

    if (existingAccount) {
      if (existingAccount.user.status !== "active") {
        throw new UnauthorizedException("Authentication required");
      }
      await this.prisma.user.update({
        where: { id: existingAccount.user.id },
        data: { lastLoginAt: new Date() }
      });
      const session = await this.createSession(existingAccount.user.id);
      return {
        user: toAuthUser(existingAccount.user),
        session
      };
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    let user: DbUser;
    if (existingUser) {
      await this.prisma.authAccount.create({
        data: {
          userId: existingUser.id,
          provider: "google",
          providerUserId,
          email
        }
      });
      await this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          lastLoginAt: new Date(),
          emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
          name: existingUser.name ?? profile.name ?? null
        }
      });
      user = {
        ...existingUser,
        name: existingUser.name ?? profile.name ?? null
      };
    } else {
      const passwordHash = await bcrypt.hash(randomToken(), 12);
      user = await this.prisma.user.create({
        data: {
          email,
          name: profile.name ?? null,
          passwordHash,
          emailVerifiedAt: new Date(),
          authAccounts: {
            create: {
              provider: "google",
              providerUserId,
              email
            }
          }
        }
      });
    }

    const session = await this.createSession(user.id);
    return {
      user: toAuthUser(user),
      session
    };
  }

  private async exchangeGoogleCode(config: GoogleAuthConfig, code: string) {
    const body = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code"
    });
    const response = await this.fetchGoogleAuth(
      config.tokenUri,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
      },
      "Google token exchange failed"
    );
    const payload = (await response.json()) as GoogleTokenResponse;

    if (!response.ok || !payload.access_token) {
      throw new BadRequestException(formatGoogleAuthError("Google token exchange failed", payload));
    }

    return {
      access_token: payload.access_token
    };
  }

  private async fetchGoogleProfile(config: GoogleAuthConfig, accessToken: string) {
    const response = await this.fetchGoogleAuth(
      config.userInfoUri,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      },
      "Google profile request failed"
    );
    const payload = (await response.json()) as GoogleUserInfoResponse;

    if (!response.ok || !payload.sub || !payload.email || payload.email_verified === false) {
      throw new BadRequestException(
        formatGoogleAuthError("Google profile request failed", payload)
      );
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name ?? null
    };
  }

  private async fetchGoogleAuth(
    url: string,
    init: Parameters<GmailFetchLike>[1],
    errorPrefix: string
  ) {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      throw new BadRequestException(`${errorPrefix}: ${readNetworkError(error)}`);
    }
  }

  private async createSession(userId: string): Promise<SessionCookie> {
    const token = randomToken();
    const expiresAt = addDays(new Date(), sessionTtlDays);
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash: hashToken(token),
        expiresAt
      }
    });

    return {
      sessionId: session.id,
      token
    };
  }

  private async getUserFromSession(session: SessionCookie | null): Promise<AuthUser> {
    if (!session) {
      throw new UnauthorizedException("Authentication required");
    }

    const record = await this.prisma.userSession.findFirst({
      where: {
        id: session.sessionId,
        refreshTokenHash: hashToken(session.token),
        expiresAt: {
          gt: new Date()
        }
      },
      include: {
        user: true
      }
    });

    if (!record || record.user.status !== "active") {
      throw new UnauthorizedException("Authentication required");
    }

    return toAuthUser(record.user);
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

type GoogleAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUri: string;
  tokenUri: string;
  userInfoUri: string;
};

function getGoogleAuthConfig(): GoogleAuthConfig {
  const clientId = process.env.GOOGLE_AUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  const apiUrl = process.env.API_URL ?? "http://localhost:4000";

  if (!clientId || !clientSecret) {
    throw new BadRequestException("Google Auth OAuth is not configured");
  }

  return {
    clientId,
    clientSecret,
    redirectUri: process.env.GOOGLE_AUTH_REDIRECT_URI ?? `${apiUrl}/api/auth/google/callback`,
    authUri: process.env.GOOGLE_AUTH_URI ?? "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUri: process.env.GOOGLE_TOKEN_URI ?? "https://oauth2.googleapis.com/token",
    userInfoUri: process.env.GOOGLE_USERINFO_URI ?? "https://www.googleapis.com/oauth2/v3/userinfo"
  };
}

function formatGoogleAuthError(
  prefix: string,
  payload: GoogleTokenResponse | GoogleUserInfoResponse
) {
  const detail = payload.error_description ?? payload.error;
  return detail ? `${prefix}: ${detail}` : prefix;
}

function readNetworkError(error: unknown) {
  if (error instanceof Error && error.message) {
    const cause = error.cause;
    if (cause instanceof Error && cause.message) {
      return `${error.message} (${cause.message})`;
    }

    return error.message;
  }

  return "network request failed";
}

function toAuthUser(user: DbUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status
  };
}

function parseOrBadRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException("Invalid request payload");
  }

  return result.data;
}
