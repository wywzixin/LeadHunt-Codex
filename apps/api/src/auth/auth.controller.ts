import { Body, Controller, Get, Inject, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService, sessionMaxAgeSeconds } from "./auth.service.js";
import {
  clearSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
  setSessionCookie
} from "./session-cookie.js";

const googleStateCookieName = "lh_google_auth_state";

@Controller("api/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("register")
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.register(body);
    setSessionCookie(response, result.session, sessionMaxAgeSeconds);

    return {
      user: result.user
    };
  }

  @Post("login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(body);
    setSessionCookie(response, result.session, sessionMaxAgeSeconds);

    return {
      user: result.user
    };
  }

  @Post("logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.logout(readSessionCookie(request));
    clearSessionCookie(response);
    return result;
  }

  @Get("me")
  me(@Req() request: Request) {
    return this.authService.me(readSessionCookie(request));
  }

  @Post("password-reset")
  requestPasswordReset(@Body() body: unknown) {
    return this.authService.requestPasswordReset(body);
  }

  @Post("forgot-password")
  forgotPassword(@Body() body: unknown) {
    return this.authService.requestPasswordReset(body);
  }

  @Post("reset-password")
  resetPassword(@Body() body: unknown) {
    return this.authService.resetPassword(body);
  }

  @Get("google")
  google(@Res() response: Response) {
    const result = this.authService.buildGoogleAuthorizationUrl();
    response.setHeader("Set-Cookie", serializeGoogleStateCookie(result.state, result.maxAgeSeconds));
    return response.redirect(result.url);
  }

  @Get("google/callback")
  async googleCallback(@Req() request: Request, @Query() query: unknown, @Res() response: Response) {
    const result = await this.authService.loginWithGoogleCallback(query, readGoogleStateCookie(request));
    response.setHeader("Set-Cookie", [
      serializeSessionCookie(result.session, sessionMaxAgeSeconds),
      serializeExpiredGoogleStateCookie()
    ]);
    return response.redirect(process.env.FRONTEND_URL ?? "http://localhost:3000");
  }
}

function serializeGoogleStateCookie(state: string, maxAgeSeconds: number) {
  return [
    `${googleStateCookieName}=${state}`,
    "HttpOnly",
    "Path=/api/auth/google",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ].join("; ");
}

function serializeExpiredGoogleStateCookie() {
  return [`${googleStateCookieName}=`, "HttpOnly", "Path=/api/auth/google", "SameSite=Lax", "Max-Age=0"].join("; ");
}

function readGoogleStateCookie(request: Request) {
  const header = request.headers.cookie;
  if (!header) {
    return null;
  }

  const cookies = header.split(";").map((part) => part.trim());
  return cookies.find((part) => part.startsWith(`${googleStateCookieName}=`))?.slice(googleStateCookieName.length + 1) ?? null;
}
