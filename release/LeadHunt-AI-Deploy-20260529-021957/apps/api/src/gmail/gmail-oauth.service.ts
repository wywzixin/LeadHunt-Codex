import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { createGmailFetchImpl, type GmailFetchLike } from "./gmail-fetch.js";
import { createGmailOAuthState, verifyGmailOAuthState } from "./gmail-oauth.state.js";
import { decryptToken, encryptToken } from "./token-encryption.js";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GmailProfileResponse = {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
};

export type GmailOAuthServiceOptions = {
  fetchImpl?: GmailFetchLike;
};

export const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly"
];

@Injectable()
export class GmailOAuthService {
  private readonly fetchImpl: GmailFetchLike;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    options: GmailOAuthServiceOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? createGmailFetchImpl();
  }

  buildAuthorizationUrl(userId: string) {
    const config = getGoogleConfig();
    const url = new URL(config.authUri);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", gmailScopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", createGmailOAuthState(userId));

    return url.toString();
  }

  async handleCallback(code: string | undefined, state: string | undefined) {
    if (!code || !state) {
      throw new BadRequestException("Missing Gmail OAuth code or state");
    }

    const payload = this.verifyCallbackState(state);
    const tokenResponse = await this.exchangeCodeForTokens(code);
    if (!tokenResponse.access_token) {
      throw new BadRequestException("Google token response did not include an access token");
    }

    const profile = await this.fetchGmailProfile(tokenResponse.access_token);
    const email = profile.emailAddress?.toLowerCase();
    if (!email) {
      throw new BadRequestException("Gmail profile did not include an email address");
    }

    const existing = await this.prisma.gmailAccount.findUnique({
      where: {
        userId_email: {
          userId: payload.userId,
          email
        }
      }
    });
    const encryptedRefreshToken = tokenResponse.refresh_token
      ? encryptToken(tokenResponse.refresh_token)
      : existing?.refreshTokenEncrypted;

    if (!encryptedRefreshToken) {
      throw new BadRequestException("Google did not return a refresh token. Revoke access and try again.");
    }

    const account = await this.prisma.gmailAccount.upsert({
      where: {
        userId_email: {
          userId: payload.userId,
          email
        }
      },
      create: {
        userId: payload.userId,
        email,
        refreshTokenEncrypted: encryptedRefreshToken
      },
      update: {
        refreshTokenEncrypted: encryptedRefreshToken,
        connectedAt: new Date(),
        revokedAt: null
      }
    });

    return {
      account: toSafeAccount(account)
    };
  }

  async getAccount(userId: string) {
    const account = await this.prisma.gmailAccount.findFirst({
      where: {
        userId,
        revokedAt: null
      },
      orderBy: { connectedAt: "desc" }
    });

    return {
      connected: Boolean(account),
      account: account ? toSafeAccount(account) : null,
      scopes: gmailScopes
    };
  }

  async revokeAccount(userId: string) {
    const account = await this.prisma.gmailAccount.findFirst({
      where: {
        userId,
        revokedAt: null
      },
      orderBy: { connectedAt: "desc" }
    });

    if (!account) {
      return { ok: true, revoked: false };
    }

    await this.tryRevokeWithGoogle(account.refreshTokenEncrypted);
    await this.prisma.gmailAccount.update({
      where: { id: account.id },
      data: { revokedAt: new Date() }
    });

    return { ok: true, revoked: true };
  }

  private async exchangeCodeForTokens(code: string) {
    const config = getGoogleConfig();
    const body = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code"
    });
    const response = await this.fetchImpl(config.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const payload = (await response.json()) as GoogleTokenResponse;

    if (!response.ok) {
      throw new BadRequestException(formatGoogleError("Google token exchange failed", response.status, payload));
    }

    return payload;
  }

  private verifyCallbackState(state: string) {
    try {
      return verifyGmailOAuthState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Gmail OAuth state";
      throw new BadRequestException(message);
    }
  }

  private async fetchGmailProfile(accessToken: string) {
    const response = await this.fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const payload = (await response.json()) as GmailProfileResponse;

    if (!response.ok) {
      throw new BadRequestException(formatGoogleError("Gmail profile request failed", response.status, payload));
    }

    return payload;
  }

  private async tryRevokeWithGoogle(refreshTokenEncrypted: string) {
    try {
      const token = decryptToken(refreshTokenEncrypted);
      await this.fetchImpl("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString()
      });
    } catch {
      // Local revocation is still valid if Google revoke is unreachable.
    }
  }
}

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new BadRequestException("Google OAuth is not configured");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    authUri: process.env.GOOGLE_AUTH_URI ?? "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUri: process.env.GOOGLE_TOKEN_URI ?? "https://oauth2.googleapis.com/token"
  };
}

function formatGoogleError(prefix: string, status: number, payload: GoogleTokenResponse | GmailProfileResponse) {
  const tokenPayload = payload as GoogleTokenResponse;
  return `${prefix} with HTTP ${status}${tokenPayload.error_description ? `: ${tokenPayload.error_description}` : ""}`;
}

function toSafeAccount(account: { id: string; email: string; connectedAt: Date; revokedAt: Date | null }) {
  return {
    id: account.id,
    email: account.email,
    connectedAt: account.connectedAt,
    revokedAt: account.revokedAt
  };
}
