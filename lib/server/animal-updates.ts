import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { AnimalDoc, AnimalWeightDoc, ImportDoc } from "@/lib/db/types";

/** Use the measurement date, never the date the administrator entered it. */
export async function recomputeAnimalCurrentWeight(db: Db, animalId: ObjectId): Promise<number | null> {
  const latest = await db.collection<AnimalWeightDoc>("animal_weights").findOne(
    { animalId }, { sort: { measuredAt: -1, createdAt: -1, _id: -1 } },
  );
  const animal = await db.collection<AnimalDoc>("animals").findOne({ _id: animalId });
  if (!animal) return null;
  const currentWeight = latest?.weight ?? animal.initialWeight ?? 0;
  await db.collection<AnimalDoc>("animals").updateOne(
    { _id: animalId }, { $set: { currentWeight, updatedAt: new Date() } },
  );
  return currentWeight;
}

/** Serialize video mutations without requiring a replica set/transaction support. */
export async function lockVideoImport(db: Db, importId: ObjectId) {
  const token = randomUUID();
  const now = new Date();
  const item = await db.collection<ImportDoc>("imports").findOneAndUpdate(
    {
      _id: importId,
      $or: [
        { mutationToken: { $exists: false } },
        { mutationStartedAt: { $lt: new Date(now.getTime() - 120_000) } },
      ],
    },
    { $set: { mutationToken: token, mutationStartedAt: now } },
    { returnDocument: "after" },
  );
  return item ? { item, token } : null;
}

export async function unlockVideoImport(db: Db, importId: ObjectId, token: string) {
  await db.collection<ImportDoc>("imports").updateOne(
    { _id: importId, mutationToken: token },
    { $unset: { mutationToken: "", mutationStartedAt: "" } },
  );
}

/** Clear both array references and the legacy primary-video pointer. */
export async function removeAnimalVideoReferences(db: Db, item: ImportDoc) {
  const animals = db.collection<AnimalDoc>("animals");
  await animals.updateMany(
    { $or: [{ "videos.importId": item._id }, ...(item.animalId ? [{ _id: item.animalId, "videos.key": item.storage.key }] : [])] },
    { $pull: { videos: { $or: [{ key: item.storage.key, importId: { $exists: false } }, { importId: item._id }] } }, $set: { updatedAt: new Date() } },
  );
  // The legacy primary pointer has no import id. Keep it if another assignment
  // on that animal still uses the same stored bytes.
  const withPrimary = await animals.find({ videoStorageKey: item.storage.key }).toArray();
  for (const animal of withPrimary) {
    const remaining = await db.collection<ImportDoc>("imports").findOne({
      _id: { $ne: item._id }, animalId: animal._id,
      "storage.key": item.storage.key, "storage.provider": item.storage.provider,
    });
    if (remaining) continue;
    await animals.updateOne(
      { _id: animal._id, videoStorageKey: item.storage.key },
      { $set: { videoStorageKey: null, videoStorageProvider: null, videoStorageBucket: null, videoStorageUrl: null, updatedAt: new Date() } },
    );
  }
}

/** A video can be removed or reassigned without erasing a recorded weighing. */
export async function preserveVideoWeight(db: Db, item: ImportDoc) {
  await db.collection<AnimalWeightDoc>("animal_weights").updateMany(
    { $or: [{ importId: item._id }, ...(item.weightId ? [{ _id: item.weightId }] : [])] },
    { $set: { importId: null, updatedAt: new Date() } },
  );
}
