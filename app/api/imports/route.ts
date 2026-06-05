import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { resolveStoredMediaUrl } from "@/lib/server/media";
import type { ImportDoc, LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lotId = request.nextUrl.searchParams.get("lotId");
  const ranchId = request.nextUrl.searchParams.get("ranchId");

  if (!lotId && !ranchId) {
    return NextResponse.json({ error: "lotId or ranchId required" }, { status: 400 });
  }

  const db = await getDb();

  let query: Record<string, ObjectId> = {};

  if (lotId) {
    if (!ObjectId.isValid(lotId)) return NextResponse.json({ error: "Invalid lotId" }, { status: 400 });
    const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(lotId) });
    if (!lot) return NextResponse.json({ error: "Lot not found" }, { status: 404 });
    const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId ?? lot.farmId });
    if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
    if (!isAdmin(user) && ranch.ownerUserId.toString() !== user.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    query = { lotId: new ObjectId(lotId) };
  } else if (ranchId) {
    if (!ObjectId.isValid(ranchId)) return NextResponse.json({ error: "Invalid ranchId" }, { status: 400 });
    const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(ranchId) });
    if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
    if (!isAdmin(user) && ranch.ownerUserId.toString() !== user.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    query = { ranchId: new ObjectId(ranchId) };
  }

  const imports = await db.collection<ImportDoc>("imports").find(query).sort({ createdAt: -1 }).toArray();

  const result = await Promise.all(
    imports.map(async (item) => ({
      ...item,
      _id: item._id.toString(),
      ranchId: (item.ranchId ?? item.farmId)?.toString(),
      lotId: item.lotId ? item.lotId.toString() : null,
      animalId: item.animalId ? item.animalId.toString() : null,
      videoUrl: item.mimeType?.startsWith("video/") || item.filename.endsWith(".mp4")
        ? await resolveStoredMediaUrl(item.storage)
        : null,
    })),
  );

  return NextResponse.json({ imports: result });
}
