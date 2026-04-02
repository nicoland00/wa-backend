import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = await getDb();
  const users = await db
    .collection("users")
    .find({ phoneStatus: "pending" })
    .sort({ updatedAt: -1 })
    .toArray();

  return NextResponse.json({
    users: users.map((item) => ({
      userId: item._id.toString(),
      email: item.email,
      name: item.name,
      phoneE164: item.phoneE164,
      phoneStatus: item.phoneStatus,
      updatedAt: item.updatedAt,
    })),
  });
}
