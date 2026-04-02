import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { getSignedDownloadUrl } from "@/lib/storage";
import { objectIdSchema } from "@/lib/validators/common";
import type { ImportDoc, RanchDoc } from "@/lib/db/types";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  }

  const db = await getDb();
  const item = await db.collection<ImportDoc>("imports").findOne({ _id: new ObjectId(parsedId.data) });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: item.ranchId ?? item.farmId });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  const owns = ranch.ownerUserId.toString() === user.userId;
  if (!isAdmin(user) && !owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const downloadUrl = await getSignedDownloadUrl(item.storage);

  return NextResponse.json({
    ...item,
    _id: item._id.toString(),
    ranchId: (item.ranchId ?? item.farmId).toString(),
    lotId: item.lotId ? item.lotId.toString() : null,
    downloadUrl,
  });
}
