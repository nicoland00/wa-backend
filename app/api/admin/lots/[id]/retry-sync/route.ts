import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { syncLotUpdate } from "@/lib/server/sync";
import { objectIdSchema } from "@/lib/validators/common";
import type { LotDoc, RanchDoc } from "@/lib/db/types";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
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

  const db = await getDb();
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(parsedId.data) });
  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  await syncLotUpdate(lot, ranch);
  const refreshed = await db.collection<LotDoc>("lots").findOne({ _id: lot._id });

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.lot.retry_sync",
    target: { type: "lot", id: parsedId.data },
    before: lot,
    after: refreshed,
  });

  if (!refreshed?.ixorigueLotId) {
    return NextResponse.json({ error: refreshed?.syncError ?? "Lot sync failed." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
