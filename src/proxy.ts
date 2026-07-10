import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login"];

export default auth((req) => {
  const isPublicPath = PUBLIC_PATHS.some((path) => req.nextUrl.pathname.startsWith(path));

  if (!req.auth && !isPublicPath) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  if (req.auth && req.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
