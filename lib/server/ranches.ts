import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canOwnAssignedRanches } from "@/lib/permissions";
import { getIxorigueRanchById } from "@/lib/server/sync";
import type { AnimalDoc, ImportDoc, LotDoc, RanchDoc, UserDoc } from "@/lib/db/types";

export async function assignExistingRanchToUser(params: {
  ownerUserId: string;
  ixorigueRanchId: string;
  adminUserId: string;
}) {
  const db = await getDb();
  const ownerObjectId = new ObjectId(params.ownerUserId);
  const adminObjectId = new ObjectId(params.adminUserId);

  const [owner, remoteRanch] = await Promise.all([
    db.collection<UserDoc>("users").findOne({ _id: ownerObjectId }),
    getIxorigueRanchById(params.ixorigueRanchId),
  ]);

  if (!owner) {
    throw new Error("Owner user not found");
  }
  if (!canOwnAssignedRanches(owner.role)) {
    throw new Error("Ranches can only be assigned to retail users");
  }

  const ranchAssignment = await db.collection<RanchDoc>("ranches").findOne({ ixorigueRanchId: params.ixorigueRanchId });
  const now = new Date();

  if (ranchAssignment) {
    await db.collection<RanchDoc>("ranches").updateOne(
      { _id: ranchAssignment._id },
      {
        $set: {
          ownerUserId: ownerObjectId,
          name: remoteRanch.name?.trim() || ranchAssignment.name,
          ixorigueRanchId: remoteRanch.id,
          syncStatus: "synced",
          syncError: null,
          createdByAdminUserId: ranchAssignment.createdByAdminUserId ?? adminObjectId,
          updatedAt: now,
        },
      },
    );

    return db.collection<RanchDoc>("ranches").findOne({ _id: ranchAssignment._id });
  }

  const ranchDoc: Omit<RanchDoc, "_id"> = {
    ownerUserId: ownerObjectId,
    name: remoteRanch.name?.trim() || remoteRanch.id,
    ixorigueRanchId: remoteRanch.id,
    syncStatus: "synced",
    syncError: null,
    createdByAdminUserId: adminObjectId,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection<RanchDoc>("ranches").insertOne(ranchDoc as RanchDoc);
  return db.collection<RanchDoc>("ranches").findOne({ _id: result.insertedId });
}

export async function getAdminRanchDetails(ranchId: string) {
  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(ranchId) });
  if (!ranch) {
    return null;
  }

  const [lots, animals, imports, owner] = await Promise.all([
    db.collection<LotDoc>("lots").find({ ranchId: ranch._id }).sort({ name: 1 }).toArray(),
    db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id }).sort({ earTagNumber: 1, createdAt: -1 }).toArray(),
    db.collection<ImportDoc>("imports").find({ ranchId: ranch._id }).sort({ createdAt: -1 }).limit(50).toArray(),
    db.collection<UserDoc>("users").findOne({ _id: ranch.ownerUserId }),
  ]);

  const animalsByLot = new Map<string, AnimalDoc[]>();
  for (const animal of animals) {
    const key = animal.lotId.toString();
    const bucket = animalsByLot.get(key) ?? [];
    bucket.push(animal);
    animalsByLot.set(key, bucket);
  }

  return {
    ranch,
    owner,
    lots,
    animals,
    imports,
    lotSummaries: lots.map((lot) => ({
      lot,
      animals: animalsByLot.get(lot._id.toString()) ?? [],
      animalCount: animalsByLot.get(lot._id.toString())?.length ?? 0,
    })),
  };
}

export async function deleteLocalRanchCascade(ranchId: string) {
  const db = await getDb();
  const _id = new ObjectId(ranchId);

  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id });
  if (!ranch) {
    return null;
  }

  const [lots, animals, imports] = await Promise.all([
    db.collection<LotDoc>("lots").find({ ranchId: _id }).project({ _id: 1 }).toArray(),
    db.collection<AnimalDoc>("animals").find({ ranchId: _id }).project({ _id: 1 }).toArray(),
    db.collection<ImportDoc>("imports").find({ ranchId: _id }).project({ _id: 1 }).toArray(),
  ]);

  const lotIds = lots.map((lot) => lot._id);
  const animalIds = animals.map((animal) => animal._id);
  const importIdStrings = imports.map((item) => item._id.toString());
  const syncEntityIds = [_id, ...lotIds, ...animalIds];

  const dataErrorClauses = [{ ranchId: _id }] as Array<Record<string, unknown>>;
  if (lotIds.length) {
    dataErrorClauses.push({ lotId: { $in: lotIds } });
  }
  if (animalIds.length) {
    dataErrorClauses.push({ animalId: { $in: animalIds } });
  }

  const [deletedWeights, deletedDataErrors, deletedSyncJobs, deletedJobs, deletedImports, deletedAnimals, deletedLots, deletedRanch] = await Promise.all([
    animalIds.length ? db.collection("animal_weights").deleteMany({ animalId: { $in: animalIds } }) : Promise.resolve({ deletedCount: 0 }),
    db.collection("data_error_requests").deleteMany({ $or: dataErrorClauses }),
    syncEntityIds.length ? db.collection("sync_jobs").deleteMany({ entityId: { $in: syncEntityIds } }) : Promise.resolve({ deletedCount: 0 }),
    importIdStrings.length ? db.collection("jobs").deleteMany({ "payload.importId": { $in: importIdStrings } }) : Promise.resolve({ deletedCount: 0 }),
    db.collection("imports").deleteMany({ ranchId: _id }),
    db.collection("animals").deleteMany({ ranchId: _id }),
    db.collection("lots").deleteMany({ ranchId: _id }),
    db.collection<RanchDoc>("ranches").deleteOne({ _id }),
  ]);

  return {
    ranch,
    summary: {
      ranchesDeleted: deletedRanch.deletedCount,
      lotsDeleted: deletedLots.deletedCount,
      animalsDeleted: deletedAnimals.deletedCount,
      animalWeightsDeleted: deletedWeights.deletedCount,
      importsDeleted: deletedImports.deletedCount,
      syncJobsDeleted: deletedSyncJobs.deletedCount,
      jobsDeleted: deletedJobs.deletedCount,
      dataErrorRequestsDeleted: deletedDataErrors.deletedCount,
    },
  };
}
