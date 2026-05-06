import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { AuthController } from "./auth.controller.js";

function responseMock(): Response {
  return {
    setHeader: vi.fn(),
    redirect: vi.fn((url: string) => ({ redirectedTo: url }))
  } as unknown as Response;
}

function requestWithCookie(cookie: string): Request {
  return {
    headers: {
      cookie
    }
  } as Request;
}

function createController() {
  const authService = {
    register: vi.fn().mockResolvedValue({
      user: { id: "user-1", email: "buyer@example.com" },
      session: { sessionId: "session-1", token: "token-1" }
    }),
    login: vi.fn().mockResolvedValue({
      user: { id: "user-1", email: "buyer@example.com" },
      session: { sessionId: "session-1", token: "token-1" }
    }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
    me: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
    requestPasswordReset: vi.fn().mockResolvedValue({ ok: true }),
    resetPassword: vi.fn().mockResolvedValue({ ok: true }),
    buildGoogleAuthorizationUrl: vi.fn().mockReturnValue({
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=state-token",
      state: "state-token",
      maxAgeSeconds: 600
    }),
    loginWithGoogleCallback: vi.fn().mockResolvedValue({
      user: { id: "user-1", email: "buyer@example.com" },
      session: { sessionId: "session-1", token: "token-1" }
    })
  };

  return {
    controller: new AuthController(authService as any),
    authService
  };
}

describe("AuthController", () => {
  it("registers and sets a session cookie", async () => {
    const { controller, authService } = createController();
    const response = responseMock();

    const result = await controller.register({ email: "buyer@example.com", password: "secure-password" }, response);

    expect(result).toEqual({ user: { id: "user-1", email: "buyer@example.com" } });
    expect(authService.register).toHaveBeenCalledWith({ email: "buyer@example.com", password: "secure-password" });
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("lh_session=session-1.token-1"));
  });

  it("logs in and sets a session cookie", async () => {
    const { controller, authService } = createController();
    const response = responseMock();

    await controller.login({ email: "buyer@example.com", password: "secure-password" }, response);

    expect(authService.login).toHaveBeenCalledWith({ email: "buyer@example.com", password: "secure-password" });
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("lh_session=session-1.token-1"));
  });

  it("logs out and clears the session cookie", async () => {
    const { controller, authService } = createController();
    const response = responseMock();

    const result = await controller.logout(requestWithCookie("lh_session=session-1.token-1"), response);

    expect(result).toEqual({ ok: true });
    expect(authService.logout).toHaveBeenCalledWith({ sessionId: "session-1", token: "token-1" });
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("Max-Age=0"));
  });

  it("supports forgot-password and password-reset compatibility routes", async () => {
    const { controller, authService } = createController();

    await controller.forgotPassword({ email: "buyer@example.com" });
    await controller.requestPasswordReset({ email: "buyer@example.com" });

    expect(authService.requestPasswordReset).toHaveBeenCalledTimes(2);
  });

  it("resets a password", async () => {
    const { controller, authService } = createController();

    await expect(
      controller.resetPassword({ token: "valid-reset-token-value", password: "new-secure-password" })
    ).resolves.toEqual({ ok: true });
    expect(authService.resetPassword).toHaveBeenCalledWith({
      token: "valid-reset-token-value",
      password: "new-secure-password"
    });
  });

  it("redirects to Google login and stores the OAuth state cookie", () => {
    const { controller } = createController();
    const response = responseMock();

    controller.google(response);

    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("lh_google_auth_state=state-token"));
    expect(response.redirect).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=state-token");
  });

  it("handles Google callback, sets session cookie, and redirects to the web app", async () => {
    const { controller, authService } = createController();
    const response = responseMock();

    await controller.googleCallback(
      requestWithCookie("lh_google_auth_state=state-token"),
      { code: "google-code", state: "state-token" },
      response
    );

    expect(authService.loginWithGoogleCallback).toHaveBeenCalledWith(
      { code: "google-code", state: "state-token" },
      "state-token"
    );
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", [
      expect.stringContaining("lh_session=session-1.token-1"),
      expect.stringContaining("lh_google_auth_state=")
    ]);
    expect(response.redirect).toHaveBeenCalledWith("http://localhost:3000");
  });
});
