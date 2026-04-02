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
  const farms = await db.collection("farms").find({ status: "pending" }).sort({ submittedAt: -1 }).toArray();

  return NextResponse.json({
    farms: farms.map((farm) => ({
      ...farm,
      _id: farm._id.toString(),
      ownerUserId: farm.ownerUserId.toString(),
    })),
  });
}
