import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { syncAnimalUpdate } from "@/lib/server/sync";
import { objectIdSchema } from "@/lib/validators/common";
import type { AnimalDoc, LotDoc, RanchDoc } from "@/lib/db/types";

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
    return NextResponse.json({ error: "Invalid animal id" }, { status: 400 });
  }

  const db = await getDb();
  const animal = await db.collection<AnimalDoc>("animals").findOne({ _id: new ObjectId(parsedId.data) });
  if (!animal) {
    return NextResponse.json({ error: "Animal not found" }, { status: 404 });
  }
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: animal.lotId });
  const ranch = lot ? await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId }) : null;
  if (!lot || !ranch) {
    return NextResponse.json({ error: "Animal lot or ranch missing" }, { status: 404 });
  }

  await syncAnimalUpdate(animal, ranch, lot);
  const refreshed = await db.collection<AnimalDoc>("animals").findOne({ _id: animal._id });

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.animal.retry_sync",
    target: { type: "animal", id: parsedId.data },
    before: animal,
    after: refreshed,
  });

  if (!refreshed?.ixorigueAnimalId) {
    return NextResponse.json({ error: refreshed?.syncError ?? "Retry failed" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, animalId: refreshed.ixorigueAnimalId });
}
