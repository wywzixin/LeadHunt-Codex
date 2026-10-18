import { describe, expect, it } from "vitest";
import { createGmailOAuthState, verifyGmailOAuthState } from "./gmail-oauth.state.js";

describe("Gmail OAuth state", () => {
  it("creates signed state that can be verified", () => {
    const state = createGmailOAuthState("user-1", "state-secret");
    const payload = verifyGmailOAuthState(state, "state-secret");

    expect(payload.userId).toBe("user-1");
    expect(payload.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects tampered state", () => {
    const state = createGmailOAuthState("user-1", "state-secret");
    const tampered = state.replace(/.$/, "x");

    expect(() => verifyGmailOAuthState(tampered, "state-secret")).toThrow("Invalid Gmail OAuth state");
  });
});
