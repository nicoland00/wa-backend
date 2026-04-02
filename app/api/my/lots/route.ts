import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { serializeLot } from "@/lib/server/serializers";
import type { LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ ownerUserId: new ObjectId(user.userId) });
  if (!ranch) {
    return NextResponse.json({ lots: [] });
  }

  const lots = await db.collection<LotDoc>("lots").find({ ranchId: ranch._id }).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ lots: lots.map(serializeLot) });
}
