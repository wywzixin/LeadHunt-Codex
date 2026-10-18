import type { Request, Response } from "express";

export const sessionCookieName = "lh_session";

export type SessionCookie = {
  sessionId: string;
  token: string;
};

export function serializeSessionCookie(session: SessionCookie, maxAgeSeconds: number) {
  const value = `${session.sessionId}.${session.token}`;

  return [
    `${sessionCookieName}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ].join("; ");
}

export function serializeExpiredSessionCookie() {
  return [`${sessionCookieName}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"].join("; ");
}

export function setSessionCookie(response: Response, session: SessionCookie, maxAgeSeconds: number) {
  response.setHeader("Set-Cookie", serializeSessionCookie(session, maxAgeSeconds));
}

export function clearSessionCookie(response: Response) {
  response.setHeader("Set-Cookie", serializeExpiredSessionCookie());
}

export function readSessionCookie(request: Request): SessionCookie | null {
  const header = request.headers.cookie;
  if (!header) {
    return null;
  }

  const cookies = header.split(";").map((part) => part.trim());
  const rawValue = cookies
    .find((part) => part.startsWith(`${sessionCookieName}=`))
    ?.slice(sessionCookieName.length + 1);

  if (!rawValue) {
    return null;
  }

  const [sessionId, token] = rawValue.split(".");
  if (!sessionId || !token) {
    return null;
  }

  return { sessionId, token };
}
