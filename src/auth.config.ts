import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe config: no Prisma/bcrypt imports here, so this can be used from
 * middleware (Edge runtime) as well as from the full config in `auth.ts`.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as "admin" | "employee";
      }
      return session;
    },
  },
};
