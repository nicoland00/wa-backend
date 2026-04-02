import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { serializeRanch } from "@/lib/server/serializers";
import type { RanchDoc } from "@/lib/db/types";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const ranches = await db
    .collection<RanchDoc>("ranches")
    .find({ ownerUserId: new ObjectId(user.userId) })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  return NextResponse.json({ ranches: ranches.map(serializeRanch) });
}
