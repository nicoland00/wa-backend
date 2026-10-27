import { ObjectId, type Db } from "mongodb";
import type { AnimalDoc, AnimalWeightDoc, ImportDoc, StoredMediaRef } from "@/lib/db/types";

export async function createAdminWeightRecord(
  db: Db,
  animalId: ObjectId,
  weight: number,
  measuredAt: Date,
) {
  const now = new Date();
  const record: AnimalWeightDoc = {
    _id: new ObjectId(),
    animalId,
    weight,
    measuredAt,
    source: "admin",
    ixorigueWeightId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<AnimalWeightDoc>("animal_weights").insertOne(record);
  return record;
}

/** Keep directly uploaded animal videos in the same library as uploaded imports. */
export async function createAnimalVideoImport(
  db: Db,
  animal: AnimalDoc,
  storage: StoredMediaRef,
  file: File,
  weight: AnimalWeightDoc,
) {
  const now = new Date();
  const record: ImportDoc = {
    _id: new ObjectId(),
    ranchId: animal.ranchId,
    lotId: animal.lotId,
    animalId: animal._id,
    weightId: weight._id,
    weight: weight.weight,
    measuredAt: weight.measuredAt,
    source: "manual_upload",
    filename: file.name,
    mimeType: file.type || "video/mp4",
    sizeBytes: file.size,
    sha256: null,
    storage,
    artifacts: [],
    status: "assigned",
    error: null,
    createdAt: now,
    assignedAt: now,
    processedAt: null,
    updatedAt: now,
  };
  await db.collection<ImportDoc>("imports").insertOne(record);
  await db.collection<AnimalWeightDoc>("animal_weights").updateOne(
    { _id: weight._id },
    { $set: { importId: record._id, updatedAt: now } },
  );
  return record;
}
