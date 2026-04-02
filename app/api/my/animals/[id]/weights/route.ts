import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { serializeAnimalWeight } from "@/lib/server/serializers";
import { syncAnimalWeight } from "@/lib/server/sync";
import { objectIdSchema } from "@/lib/validators/common";
import { animalWeightCreateSchema } from "@/lib/validators/animals";
import type { AnimalDoc, AnimalWeightDoc, RanchDoc } from "@/lib/db/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid animal id" }, { status: 400 });
  }

  const parsed = animalWeightCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const animal = await db.collection<AnimalDoc>("animals").findOne({ _id: new ObjectId(parsedId.data) });
  if (!animal) {
    return NextResponse.json({ error: "Animal not found" }, { status: 404 });
  }
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: animal.ranchId });
  if (!ranch || (user.role !== "admin" && ranch.ownerUserId.toString() !== user.userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const weightDoc: Omit<AnimalWeightDoc, "_id"> = {
    animalId: animal._id,
    ixorigueWeightId: null,
    weight: parsed.data.weight,
    measuredAt: parsed.data.measuredAt ?? now,
    source: user.role === "admin" ? "admin" : "user",
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection<AnimalWeightDoc>("animal_weights").insertOne(weightDoc as AnimalWeightDoc);
  await db.collection<AnimalDoc>("animals").updateOne({ _id: animal._id }, { $set: { currentWeight: weightDoc.weight, updatedAt: now } });
  const created = await db.collection<AnimalWeightDoc>("animal_weights").findOne({ _id: result.insertedId });

  await logAudit({
    actorUserId: user.userId,
    actorRole: user.role,
    action: "animal.weight.submit",
    target: { type: "animal", id: parsedId.data },
    after: created,
  });

  if (created) {
    await syncAnimalWeight(created, animal, ranch);
  }

  const refreshed = await db.collection<AnimalWeightDoc>("animal_weights").findOne({ _id: result.insertedId });
  return NextResponse.json({ weight: refreshed ? serializeAnimalWeight(refreshed) : null }, { status: 201 });
}
