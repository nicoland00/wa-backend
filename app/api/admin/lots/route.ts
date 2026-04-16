import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { serializeLot } from "@/lib/server/serializers";
import { syncLotCreate } from "@/lib/server/sync";
import { lotCreateSchema } from "@/lib/validators/lots";
import type { LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ranchId = request.nextUrl.searchParams.get("ranchId");
  const filter = ranchId && ObjectId.isValid(ranchId) ? { ranchId: new ObjectId(ranchId) } : {};
  const db = await getDb();
  const lots = await db.collection<LotDoc>("lots").find(filter).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ lots: lots.map(serializeLot) });
}

export async function POST(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = lotCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(parsed.data.ranchId) });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  const now = new Date();
  const lot: Omit<LotDoc, "_id"> = {
    ranchId: ranch._id,
    farmId: ranch._id,
    name: parsed.data.name,
    ixorigueLotId: null,
    geometry: parsed.data.geometry ?? null,
    syncStatus: "pending",
    syncError: null,
    createdByAdminUserId: new ObjectId(actor.userId),
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection<LotDoc>("lots").insertOne(lot as LotDoc);
  const created = await db.collection<LotDoc>("lots").findOne({ _id: result.insertedId });
  if (!created) {
    return NextResponse.json({ error: "Failed to create lot" }, { status: 500 });
  }

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.lot.create",
    target: { type: "lot", id: created._id.toString() },
    after: created,
  });

  await syncLotCreate(created, ranch);
  const refreshed = await db.collection<LotDoc>("lots").findOne({ _id: created._id });
  if (!refreshed) {
    return NextResponse.json({ error: "Lot sync result missing" }, { status: 500 });
  }
  if (!refreshed.ixorigueLotId) {
    return NextResponse.json(
      { error: refreshed.syncError ?? "Lot was created locally but could not be synced to Ixorigue.", lot: serializeLot(refreshed) },
      { status: 400 },
    );
  }
  return NextResponse.json({ lot: serializeLot(refreshed) }, { status: 201 });
}
