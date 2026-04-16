import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { serializeLot } from "@/lib/server/serializers";
import { syncLotUpdate } from "@/lib/server/sync";
import { objectIdSchema } from "@/lib/validators/common";
import { lotPatchSchema } from "@/lib/validators/lots";
import type { LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid lot id" }, { status: 400 });
  }

  const db = await getDb();
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(parsedId.data) });
  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }

  return NextResponse.json({ lot: serializeLot(lot) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid lot id" }, { status: 400 });
  }

  const parsed = lotPatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const before = await db.collection<LotDoc>("lots").findOne({ _id });
  if (!before) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }

  const nextRanchId = before.ranchId;
  await db.collection<LotDoc>("lots").updateOne({ _id }, { $set: { ...parsed.data, ranchId: nextRanchId, farmId: nextRanchId, updatedAt: new Date() } });
  const after = await db.collection<LotDoc>("lots").findOne({ _id });
  const ranch = after ? await db.collection<RanchDoc>("ranches").findOne({ _id: after.ranchId }) : null;

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.lot.update",
    target: { type: "lot", id: parsedId.data },
    before,
    after,
  });

  if (after && ranch) {
    await syncLotUpdate(after, ranch);
  }

  const refreshed = await db.collection<LotDoc>("lots").findOne({ _id });
  return NextResponse.json({ lot: refreshed ? serializeLot(refreshed) : null });
}
