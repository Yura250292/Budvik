import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { findSalesRepByRefCode, REF_COOKIE } from "./ref-code";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
        });

        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          boltsBalance: user.boltsBalance,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const email = user.email!;
        let dbUser = await prisma.user.findUnique({ where: { email } });

        if (!dbUser) {
          /**
           * Клієнт міг прийти за QR торгового і зареєструватись через Google.
           * cookies() тут доступний, бо signIn викликається з route handler;
           * try/catch — страховка на випадок виклику поза request scope,
           * щоб збій куки ніколи не ламав сам вхід.
           */
          let referredBySalesRepId: string | null = null;
          try {
            const { cookies } = await import("next/headers");
            const refCode = (await cookies()).get(REF_COOKIE)?.value;
            referredBySalesRepId = (await findSalesRepByRefCode(refCode))?.id ?? null;
          } catch {
            referredBySalesRepId = null;
          }

          dbUser = await prisma.user.create({
            data: {
              email,
              name: user.name || email.split("@")[0],
              role: "CLIENT",
              boltsBalance: 50,
              referredBySalesRepId,
            },
          });
          await prisma.boltsTransaction.create({
            data: {
              userId: dbUser.id,
              amount: 50,
              type: "EARNED",
              description: "Бонус за реєстрацію",
            },
          });
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google") {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email! },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.id = dbUser.id;
          token.boltsBalance = dbUser.boltsBalance;
        }
      } else if (user) {
        token.role = (user as any).role;
        token.id = user.id;
        token.boltsBalance = (user as any).boltsBalance;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
        (session.user as any).boltsBalance = token.boltsBalance;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
