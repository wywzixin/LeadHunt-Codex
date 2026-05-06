import { NextResponse, type NextRequest } from "next/server";

const publicPaths = ["/login", "/register", "/forgot-password"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/images/")
  ) {
    return NextResponse.next();
  }

  const hasSession = request.headers
    .get("cookie")
    ?.split(";")
    .some((part) => part.trim().startsWith("lh_session="));
  if (hasSession) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!favicon.ico).*)"]
};
