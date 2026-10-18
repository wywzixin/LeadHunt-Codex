import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type GmailOAuthStatePayload = {
  userId: string;
  nonce: string;
  expiresAt: number;
};

export function createGmailOAuthState(
  userId: string,
  secret = process.env.SESSION_SECRET ?? process.env.TOKEN_ENCRYPTION_KEY
) {
  const payload: GmailOAuthStatePayload = {
    userId,
    nonce: randomBytes(16).toString("base64url"),
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifyGmailOAuthState(
  state: string,
  secret = process.env.SESSION_SECRET ?? process.env.TOKEN_ENCRYPTION_KEY
) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid Gmail OAuth state");
  }

  const expected = sign(encodedPayload, secret);
  if (!safeEqual(signature, expected)) {
    throw new Error("Invalid Gmail OAuth state signature");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as GmailOAuthStatePayload;
  if (!payload.userId || payload.expiresAt < Date.now()) {
    throw new Error("Expired Gmail OAuth state");
  }

  return payload;
}

function sign(value: string, secret: string | undefined) {
  if (!secret) {
    throw new Error("SESSION_SECRET or TOKEN_ENCRYPTION_KEY is required before starting Gmail OAuth.");
  }

  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
