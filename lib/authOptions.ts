import type { DefaultSession, NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getDb } from "@/lib/mongodb";
import type { PhoneStatus, Role, UserDoc } from "@/lib/db/types";

declare module "next-auth" {
  interface Session {
    user: {
      userId: string;
      role: Role;
      phoneE164: string | null;
      phoneStatus: PhoneStatus;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: Role;
    phoneE164?: string | null;
    phoneStatus?: PhoneStatus;
  }
}

async function getUserByEmail(email: string): Promise<UserDoc | null> {
  const db = await getDb();
  return db.collection<UserDoc>("users").findOne({ email });
}

const providers = [];

// Solo registrar GoogleProvider si las credenciales están configuradas
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) {
        return false;
      }

      const db = await getDb();
      const now = new Date();

      await db.collection("users").updateOne(
        { email: user.email },
        {
          $setOnInsert: {
            email: user.email,
            role: "user",
            phoneE164: null,
            phoneStatus: "none",
            createdAt: now,
          },
          $set: {
            name: user.name ?? null,
            updatedAt: now,
          },
        },
        { upsert: true },
      );

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
      }

      if (!token.email) {
        return token;
      }

      const dbUser = await getUserByEmail(token.email);
      if (dbUser) {
        token.userId = dbUser._id.toString();
        token.role = dbUser.role;
        token.phoneE164 = dbUser.phoneE164;
        token.phoneStatus = dbUser.phoneStatus;
      }

      return token;
    },
    async session({ session, token }) {
      if (!session.user) {
        return session;
      }

      session.user.userId = token.userId ?? "";
      session.user.role = token.role ?? "user";
      session.user.phoneE164 = token.phoneE164 ?? null;
      session.user.phoneStatus = token.phoneStatus ?? "none";

      return session;
    },
  },
  pages: { signIn: "/login" },
};
