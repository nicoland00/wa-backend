import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
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

  const ownerAssignment = await db.collection<RanchDoc>("ranches").findOne({ ownerUserId: ownerObjectId });
  const ranchAssignment = await db.collection<RanchDoc>("ranches").findOne({ ixorigueRanchId: params.ixorigueRanchId });
  const now = new Date();

  if (ownerAssignment && ranchAssignment && ownerAssignment._id.toString() !== ranchAssignment._id.toString()) {
    throw new Error("Assignment conflict: this user and remote ranch are already linked to different local records");
  }

  const target = ownerAssignment ?? ranchAssignment;
  if (target) {
    await db.collection<RanchDoc>("ranches").updateOne(
      { _id: target._id },
      {
        $set: {
          ownerUserId: ownerObjectId,
          name: remoteRanch.name?.trim() || target.name,
          ixorigueRanchId: remoteRanch.id,
          syncStatus: "synced",
          syncError: null,
          createdByAdminUserId: target.createdByAdminUserId ?? adminObjectId,
          updatedAt: now,
        },
      },
    );

    return db.collection<RanchDoc>("ranches").findOne({ _id: target._id });
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
