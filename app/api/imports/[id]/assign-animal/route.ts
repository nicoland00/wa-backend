import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { lockVideoImport, preserveVideoWeight, recomputeAnimalCurrentWeight, removeAnimalVideoReferences, unlockVideoImport } from "@/lib/server/animal-updates";
import { syncAnimalWeight } from "@/lib/server/sync";
import { objectIdSchema } from "@/lib/validators/common";
import { videoAnimalAssignmentSchema } from "@/lib/validators/animals";
import type { AnimalDoc, AnimalWeightDoc, ImportDoc, RanchDoc } from "@/lib/db/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  const parsed = videoAnimalAssignmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Selecciona un animal e introduce el peso y la fecha del pesaje." }, { status: 400 });

  const db = await getDb();
  let importId = new ObjectId(id);
  const initial = await db.collection<ImportDoc>("imports").findOne({ _id: importId });
  if (!initial) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  if (!initial.mimeType?.startsWith("video/") && !/\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(initial.filename)) {
    return NextResponse.json({ error: "El archivo seleccionado no es un vídeo." }, { status: 400 });
  }
  const animal = await db.collection<AnimalDoc>("animals").findOne({ _id: new ObjectId(parsed.data.animalId) });
  if (!animal) return NextResponse.json({ error: "Animal not found" }, { status: 404 });
  if (!(initial.ranchId ?? initial.farmId)?.equals(animal.ranchId ?? animal.farmId!)) {
    return NextResponse.json({ error: "El animal debe pertenecer a la misma finca que el vídeo." }, { status: 400 });
  }
  if (initial.weight != null && initial.measuredAt &&
      (initial.weight !== parsed.data.weight || initial.measuredAt.getTime() !== parsed.data.measuredAt.getTime())) {
    return NextResponse.json({ error: "El peso y la fecha pertenecen al vídeo. Selecciona otro registro para añadir un pesaje diferente." }, { status: 400 });
  }
  if (initial.animalId && !initial.animalId.equals(animal._id)) {
    const previous = await db.collection<ImportDoc>("imports").findOne({
      animalId: animal._id, "storage.key": initial.storage.key, "storage.provider": initial.storage.provider,
      weight: parsed.data.weight, measuredAt: parsed.data.measuredAt,
    });
    if (previous) return NextResponse.json({ ok: true });
    importId = new ObjectId();
    const { mutationToken: _token, mutationStartedAt: _started, ...record } = initial;
    void _token; void _started;
    await db.collection<ImportDoc>("imports").insertOne({ ...record, _id: importId, animalId: null, weightId: null, assignedAt: null });
  }
  const lock = await lockVideoImport(db, importId);
  if (!lock) return NextResponse.json({ error: "Este vídeo se está actualizando. Inténtalo de nuevo." }, { status: 409 });
  const { item, token } = lock;
  let weightToSync: AnimalWeightDoc | null = null;
  try {
    const sameAssignment = item.animalId?.equals(animal._id)
      && item.weight === parsed.data.weight
      && item.measuredAt?.getTime() === parsed.data.measuredAt.getTime();
    const weightId = sameAssignment && item.weightId ? item.weightId : new ObjectId();
    if (!sameAssignment) {
      await removeAnimalVideoReferences(db, item);
      await preserveVideoWeight(db, item);
    }
    const now = new Date();
    const assignedAt = sameAssignment ? item.assignedAt ?? now : now;
    // Store the operation's identity first so a retry can resume the same weighing.
    await db.collection<ImportDoc>("imports").updateOne(
      { _id: importId, mutationToken: token },
      { $set: { animalId: animal._id, weightId, weight: parsed.data.weight, measuredAt: parsed.data.measuredAt, assignedAt, status: "assigned", updatedAt: now } },
    );
    const result = await db.collection<AnimalWeightDoc>("animal_weights").updateOne(
      { _id: weightId },
      { $setOnInsert: { animalId: animal._id, importId, weight: parsed.data.weight, measuredAt: parsed.data.measuredAt, source: "admin", ixorigueWeightId: null, syncStatus: "pending", syncError: null, createdAt: now, updatedAt: now } },
      { upsert: true },
    );
    await db.collection<AnimalDoc>("animals").updateOne(
      { _id: animal._id },
      { $set: { videoStorageKey: item.storage.key, videoStorageProvider: item.storage.provider, videoStorageBucket: item.storage.bucket ?? null, videoStorageUrl: item.storage.url ?? null, updatedAt: now },
        $addToSet: { videos: { ...item.storage, importId, addedAt: assignedAt, measuredAt: parsed.data.measuredAt, weight: parsed.data.weight } } },
    );
    await recomputeAnimalCurrentWeight(db, animal._id);
    if (result.upsertedCount) weightToSync = await db.collection<AnimalWeightDoc>("animal_weights").findOne({ _id: weightId });
    await logAudit({ actorUserId: user.userId, actorRole: user.role, action: "admin.video.assign", target: { type: "import", id }, after: { animalId: animal._id, weightId, weight: parsed.data.weight, measuredAt: parsed.data.measuredAt } });
  } finally {
    await unlockVideoImport(db, importId, token);
  }
  if (weightToSync) {
    const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: animal.ranchId ?? animal.farmId });
    if (ranch?.ixorigueRanchId && animal.ixorigueAnimalId) await syncAnimalWeight(weightToSync, animal, ranch);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  const db = await getDb();
  const importId = new ObjectId(id);
  const existing = await db.collection<ImportDoc>("imports").findOne({ _id: importId });
  if (!existing) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  const lock = await lockVideoImport(db, importId);
  if (!lock) return NextResponse.json({ error: "Este vídeo se está actualizando. Inténtalo de nuevo." }, { status: 409 });
  try {
    await removeAnimalVideoReferences(db, lock.item);
    await preserveVideoWeight(db, lock.item);
    await db.collection<ImportDoc>("imports").updateOne(
      { _id: importId, mutationToken: lock.token },
      { $set: { animalId: null, weightId: null, assignedAt: null, status: "stored", updatedAt: new Date() } },
    );
    await logAudit({ actorUserId: user.userId, actorRole: user.role, action: "admin.video.detach", target: { type: "import", id }, before: existing });
  } finally {
    await unlockVideoImport(db, importId, lock.token);
  }
  return NextResponse.json({ ok: true });
}
