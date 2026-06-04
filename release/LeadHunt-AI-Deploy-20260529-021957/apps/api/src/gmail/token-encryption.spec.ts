import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./token-encryption.js";

describe("Gmail token encryption", () => {
  it("encrypts and decrypts refresh tokens without storing plaintext", () => {
    const secret = "test-token-encryption-secret";
    const encrypted = encryptToken("refresh-token-value", secret);

    expect(encrypted).not.toContain("refresh-token-value");
    expect(decryptToken(encrypted, secret)).toBe("refresh-token-value");
  });
});
