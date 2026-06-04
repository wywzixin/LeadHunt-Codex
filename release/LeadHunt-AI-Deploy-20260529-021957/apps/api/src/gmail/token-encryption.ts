import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

export function encryptToken(token: string, secret = process.env.TOKEN_ENCRYPTION_KEY) {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptToken(value: string, secret = process.env.TOKEN_ENCRYPTION_KEY) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Unsupported encrypted token format");
  }

  const key = deriveKey(secret);
  const decipher = createDecipheriv(algorithm, key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function deriveKey(secret: string | undefined) {
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required before storing Gmail tokens.");
  }

  return createHash("sha256").update(secret).digest();
}
