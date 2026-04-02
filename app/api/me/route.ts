import { NextResponse } from "next/server";
import { requireSessionUser, getDbUserBySessionEmail } from "@/lib/server/auth";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await getDbUserBySessionEmail(user.email);
  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    userId: dbUser._id.toString(),
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
    phoneE164: dbUser.phoneE164,
    phoneStatus: dbUser.phoneStatus,
    ixorigueUserId: dbUser.ixorigueUserId ?? null,
  });
}
