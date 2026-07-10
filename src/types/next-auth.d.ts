import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: "admin" | "employee";
  }

  interface Session {
    user: {
      id: string;
      role: "admin" | "employee";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "admin" | "employee";
  }
}
