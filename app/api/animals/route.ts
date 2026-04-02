import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lotId = request.nextUrl.searchParams.get("lotId");
  if (!lotId || !ObjectId.isValid(lotId)) {
    return NextResponse.json({ error: "lotId required" }, { status: 400 });
  }

  const db = await getDb();
  const lot = await db.collection("lots").findOne({ _id: new ObjectId(lotId) });
  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }

  const farm = await db.collection("farms").findOne({ _id: lot.farmId });
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  const owns = farm.ownerUserId.toString() === user.userId;
  if (!isAdmin(user) && !owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const animals = await db.collection("animals").find({ lotId: new ObjectId(lotId) }).sort({ createdAt: -1 }).toArray();

  return NextResponse.json({
    animals: animals.map((item) => ({
      ...item,
      _id: item._id.toString(),
      farmId: item.farmId.toString(),
      lotId: item.lotId.toString(),
    })),
  });
}
