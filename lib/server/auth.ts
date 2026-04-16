import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { authOptions } from "@/lib/authOptions";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens, isAdminRole, normalizeRole } from "@/lib/permissions";
import type { Role, UserDoc } from "@/lib/db/types";

export type SessionUser = {
  userId: string;
  email: string;
  role: Role;
  phoneE164: string | null;
  phoneStatus: "none" | "pending" | "approved" | "rejected";
};

export async function requireSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return null;
  }

  return {
    userId: session.user.userId,
    email: session.user.email,
    role: session.user.role,
    phoneE164: session.user.phoneE164,
    phoneStatus: session.user.phoneStatus,
  };
}

export async function getDbUserBySessionEmail(email: string): Promise<UserDoc | null> {
  const db = await getDb();
  return db.collection<UserDoc>("users").findOne({ email });
}

export function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}

export function isAdmin(user: SessionUser): boolean {
  return isAdminRole(user);
}

export function canViewAdmin(user: SessionUser): boolean {
  return canViewAdminScreens(user);
}

export function normalizeSessionRole(role: string | null | undefined): Role {
  return normalizeRole(role);
}
