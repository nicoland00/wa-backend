import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import type { ImportDoc, LotDoc, RanchDoc } from "@/lib/db/types";

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
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(lotId) });
  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }

  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId ?? lot.farmId });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  const owns = ranch.ownerUserId.toString() === user.userId;
  if (!isAdmin(user) && !owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const imports = await db.collection<ImportDoc>("imports").find({ lotId: new ObjectId(lotId) }).sort({ createdAt: -1 }).toArray();

  return NextResponse.json({
    imports: imports.map((item) => ({
      ...item,
      _id: item._id.toString(),
      ranchId: (item.ranchId ?? item.farmId).toString(),
      lotId: item.lotId ? item.lotId.toString() : null,
    })),
  });
}
