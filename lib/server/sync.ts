import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  addAnimalWeight,
  createAnimal,
  createLot,
  getAnimalsByRanch,
  getLotById,
  getLotsByRanch,
  getRanchOverview,
  getRanches,
  updateAnimal,
  updateLot,
  updateRanchSettings,
} from "@/lib/ixorigue/client";
import type {
  AnimalDoc,
  AnimalWeightDoc,
  LotDoc,
  RanchDoc,
  SyncEntityType,
  SyncJobAction,
} from "@/lib/db/types";
import type { IxorigueAnimalDto, IxorigueLotDto, IxorigueRanchDto } from "@/lib/ixorigue/types";

type AnimalSyncOptions = {
  selfieFile?: File | null;
  deleteSelfie?: boolean;
};

/** Ixorigue creates animals at ranch level; they must be added to the lot via AnimalsLots PUT. */
async function assignAnimalToIxorigueLot(ranchIxorigueId: string, lot: LotDoc, ixorigueAnimalId: string) {
  if (!lot.ixorigueLotId) {
    throw new Error("Lot missing ixorigueLotId");
  }
  const remote = await getLotById(ranchIxorigueId, lot.ixorigueLotId);
  const merged = [...new Set([...(remote.animalIds ?? []), ixorigueAnimalId])];
  if (process.env.NODE_ENV !== "production") {
    console.error("[Ixorigue] assignAnimalToIxorigueLot", {
      ranchIxorigueId,
      ixorigueLotId: lot.ixorigueLotId,
      lotName: remote.name ?? lot.name,
      existingAnimalIds: remote.animalIds ?? [],
      mergedAnimalIds: merged,
      zoneId: remote.zoneId ?? null,
      color: remote.color ?? null,
      isFattening: remote.isFattening ?? false,
    });
  }
  await updateLot(ranchIxorigueId, {
    localLotId: lot._id.toString(),
    ixorigueRanchId: ranchIxorigueId,
    ixorigueLotId: lot.ixorigueLotId,
    name: remote.name ?? lot.name,
    animals: merged,
    isFattening: remote.isFattening ?? false,
    ...(remote.zoneId ? { zoneId: remote.zoneId } : {}),
    ...(remote.color ? { hexRgbColor: remote.color } : {}),
  });
}

async function markAnimalSyncedAfterLotAssignment(animalId: ObjectId, ixorigueAnimalId: string) {
  const db = await getDb();
  await db.collection("animals").updateOne(
    { _id: animalId },
    { $set: { ixorigueAnimalId, syncStatus: "synced", syncError: null, updatedAt: new Date() } },
  );
}

type SyncJobInput = {
  entityType: SyncEntityType;
  entityId: ObjectId;
  action: SyncJobAction;
  status?: "queued" | "running" | "done" | "failed";
  attempts?: number;
  lastError?: string | null;
};

type RemoteSyncSummary = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
};

function asDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickRemoteRanchName(remote: IxorigueRanchDto) {
  return remote.name?.trim() || remote.code?.trim() || remote.id;
}

export async function recordSyncJob(input: SyncJobInput) {
  const db = await getDb();
  const now = new Date();
  await db.collection("sync_jobs").insertOne({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    provider: "ixorigue",
    status: input.status ?? "queued",
    attempts: input.attempts ?? 0,
    lastError: input.lastError ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

async function finalizeSyncJob(entityType: SyncEntityType, entityId: ObjectId, status: "done" | "failed", lastError: string | null) {
  const db = await getDb();
  await db.collection("sync_jobs").findOneAndUpdate(
    { entityType, entityId, status: { $in: ["queued", "running"] } },
    { $set: { status, lastError, updatedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { createdAt: -1 } },
  );
}

export async function getIxorigueRanchById(ixorigueRanchId: string) {
  const ranches = await getRanches();
  const match = ranches.find((item) => item.id === ixorigueRanchId);
  if (match) {
    return match;
  }

  const overview = await getRanchOverview(ixorigueRanchId);
  return {
    id: overview.id,
    name: overview.name ?? ixorigueRanchId,
    externalId: null,
    code: null,
  } satisfies IxorigueRanchDto;
}

export async function syncRanchLink(ranch: RanchDoc) {
  await recordSyncJob({ entityType: "ranch", entityId: ranch._id, action: "link", status: "running" });
  const db = await getDb();

  try {
    if (!ranch.ixorigueRanchId) {
      throw new Error("Ranch missing ixorigueRanchId");
    }

    const remoteRanch = await getIxorigueRanchById(ranch.ixorigueRanchId);
    await db.collection("ranches").updateOne(
      { _id: ranch._id },
      {
        $set: {
          name: pickRemoteRanchName(remoteRanch),
          syncStatus: "synced",
          syncError: null,
          updatedAt: new Date(),
        },
      },
    );
    await finalizeSyncJob("ranch", ranch._id, "done", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection("ranches").updateOne(
      { _id: ranch._id },
      { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } },
    );
    await finalizeSyncJob("ranch", ranch._id, "failed", message);
  }
}

export async function syncRanchUpdate(ranch: RanchDoc) {
  if (!ranch.ixorigueRanchId) {
    await syncRanchLink(ranch);
    return;
  }

  await recordSyncJob({ entityType: "ranch", entityId: ranch._id, action: "update", status: "running" });
  const db = await getDb();
  try {
    await updateRanchSettings(ranch.ixorigueRanchId, { name: ranch.name });
    await db.collection("ranches").updateOne(
      { _id: ranch._id },
      { $set: { syncStatus: "synced", syncError: null, updatedAt: new Date() } },
    );
    await finalizeSyncJob("ranch", ranch._id, "done", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection("ranches").updateOne({ _id: ranch._id }, { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } });
    await finalizeSyncJob("ranch", ranch._id, "failed", message);
  }
}

export async function syncLotCreate(lot: LotDoc, ranch: RanchDoc) {
  if (!ranch.ixorigueRanchId) {
    throw new Error("Ranch missing ixorigueRanchId");
  }

  await recordSyncJob({ entityType: "lot", entityId: lot._id, action: "create", status: "running" });
  const db = await getDb();
  try {
    const result = await createLot(ranch.ixorigueRanchId, {
      localLotId: lot._id.toString(),
      ixorigueRanchId: ranch.ixorigueRanchId,
      name: lot.name,
      geometry: lot.geometry,
    });
    await db.collection("lots").updateOne(
      { _id: lot._id },
      { $set: { ixorigueLotId: result.id, syncStatus: "synced", syncError: null, updatedAt: new Date() } },
    );
    await finalizeSyncJob("lot", lot._id, "done", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection("lots").updateOne({ _id: lot._id }, { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } });
    await finalizeSyncJob("lot", lot._id, "failed", message);
  }
}

export async function syncLotUpdate(lot: LotDoc, ranch: RanchDoc) {
  if (!ranch.ixorigueRanchId) {
    throw new Error("Ranch missing ixorigueRanchId");
  }
  if (!lot.ixorigueLotId) {
    await syncLotCreate(lot, ranch);
    return;
  }

  await recordSyncJob({ entityType: "lot", entityId: lot._id, action: "update", status: "running" });
  const db = await getDb();
  try {
    await updateLot(ranch.ixorigueRanchId, {
      ixorigueLotId: lot.ixorigueLotId,
      localLotId: lot._id.toString(),
      ixorigueRanchId: ranch.ixorigueRanchId,
      name: lot.name,
      geometry: lot.geometry,
    });
    await db.collection("lots").updateOne({ _id: lot._id }, { $set: { syncStatus: "synced", syncError: null, updatedAt: new Date() } });
    await finalizeSyncJob("lot", lot._id, "done", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection("lots").updateOne({ _id: lot._id }, { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } });
    await finalizeSyncJob("lot", lot._id, "failed", message);
  }
}

async function createInitialWeightRecord(animal: AnimalDoc, source: AnimalWeightDoc["source"]) {
  const db = await getDb();
  const existing = await db.collection<AnimalWeightDoc>("animal_weights").findOne(
    { animalId: animal._id, source, weight: animal.initialWeight },
    { sort: { createdAt: 1 } },
  );
  if (existing) {
    return existing;
  }

  const now = new Date();
  const weightDoc: Omit<AnimalWeightDoc, "_id"> = {
    animalId: animal._id,
    ixorigueWeightId: null,
    weight: animal.initialWeight,
    measuredAt: now,
    source,
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection<AnimalWeightDoc>("animal_weights").insertOne(weightDoc as AnimalWeightDoc);
  return db.collection<AnimalWeightDoc>("animal_weights").findOne({ _id: result.insertedId });
}

export async function syncAnimalCreate(animal: AnimalDoc, ranch: RanchDoc, lot: LotDoc, options: AnimalSyncOptions = {}) {
  if (!ranch.ixorigueRanchId || !lot.ixorigueLotId) {
    throw new Error("Missing upstream Ixorigue ranch or lot id");
  }

  await recordSyncJob({ entityType: "animal", entityId: animal._id, action: "create", status: "running" });
  const db = await getDb();
  try {
    const fallbackBirthDate = animal.birthDate ?? animal.createdAt ?? new Date();
    const result = await createAnimal({
      localAnimalId: animal._id.toString(),
      ixorigueRanchId: ranch.ixorigueRanchId,
      specie: animal.specie?.trim() || "cow",
      sex: animal.sex,
      breed: animal.breed,
      earTagNumber: animal.earTagNumber,
      name: animal.name ?? animal.earTagNumber,
      deviceId: animal.deviceId ?? undefined,
      registerReason: animal.registerReason ?? (animal.dateOfPurchase ? "purchase" : "birth"),
      birthDate: animal.birthDate ? animal.birthDate.toISOString().slice(0, 10) : (!animal.dateOfPurchase ? fallbackBirthDate.toISOString().slice(0, 10) : undefined),
      dateOfPurchase: animal.dateOfPurchase ? animal.dateOfPurchase.toISOString().slice(0, 10) : undefined,
      selfieFile: options.selfieFile ?? null,
      ixorigueLotId: lot.ixorigueLotId,
    });
    try {
      await assignAnimalToIxorigueLot(ranch.ixorigueRanchId, lot, result.id);
    } catch (lotError) {
      const lotMessage = lotError instanceof Error ? lotError.message : String(lotError);
      await db.collection("animals").updateOne(
        { _id: animal._id },
        {
          $set: {
            ixorigueAnimalId: result.id,
            syncStatus: "failed",
            syncError: `Animal exists in Ixorigue (${result.id}) but could not be added to the lot: ${lotMessage}`,
            updatedAt: new Date(),
          },
        },
      );
      await finalizeSyncJob("animal", animal._id, "failed", lotMessage);
      return;
    }
    await db.collection("animals").updateOne(
      { _id: animal._id },
      { $set: { ixorigueAnimalId: result.id, syncStatus: "synced", syncError: null, updatedAt: new Date() } },
    );

    const refreshedAnimal = await db.collection<AnimalDoc>("animals").findOne({ _id: animal._id });
    if (refreshedAnimal && refreshedAnimal.initialWeight > 0) {
      const localWeight = await createInitialWeightRecord(refreshedAnimal, "admin");
      if (localWeight) {
        await syncAnimalWeight(localWeight, { ...refreshedAnimal, ixorigueAnimalId: result.id }, ranch, { defaultTag: "birth", defaultTitle: "Initial weight" });
      }
    }

    await finalizeSyncJob("animal", animal._id, "done", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection("animals").updateOne({ _id: animal._id }, { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } });
    await finalizeSyncJob("animal", animal._id, "failed", message);
  }
}

export async function syncAnimalUpdate(animal: AnimalDoc, ranch: RanchDoc, lot: LotDoc, options: AnimalSyncOptions = {}) {
  if (!animal.ixorigueAnimalId) {
    await syncAnimalCreate(animal, ranch, lot, options);
    return;
  }
  if (!ranch.ixorigueRanchId || !lot.ixorigueLotId) {
    throw new Error("Missing upstream Ixorigue ranch or lot id");
  }

  await recordSyncJob({ entityType: "animal", entityId: animal._id, action: "update", status: "running" });
  const db = await getDb();
  try {
    if (animal.syncError?.includes("could not be added to the lot")) {
      await assignAnimalToIxorigueLot(ranch.ixorigueRanchId, lot, animal.ixorigueAnimalId);
      await markAnimalSyncedAfterLotAssignment(animal._id, animal.ixorigueAnimalId);
      await finalizeSyncJob("animal", animal._id, "done", null);
      return;
    }

    const fallbackBirthDate = animal.birthDate ?? animal.createdAt ?? new Date();
    await updateAnimal({
      ixorigueAnimalId: animal.ixorigueAnimalId,
      localAnimalId: animal._id.toString(),
      ixorigueRanchId: ranch.ixorigueRanchId,
      specie: animal.specie?.trim() || "cow",
      sex: animal.sex,
      breed: animal.breed,
      earTagNumber: animal.earTagNumber,
      name: animal.name ?? animal.earTagNumber,
      deviceId: animal.deviceId ?? undefined,
      registerReason: animal.registerReason ?? (animal.dateOfPurchase ? "purchase" : "birth"),
      birthDate: animal.birthDate ? animal.birthDate.toISOString().slice(0, 10) : (!animal.dateOfPurchase ? fallbackBirthDate.toISOString().slice(0, 10) : undefined),
      dateOfPurchase: animal.dateOfPurchase ? animal.dateOfPurchase.toISOString().slice(0, 10) : undefined,
      selfieFile: options.selfieFile ?? null,
      deleteSelfie: options.deleteSelfie ?? false,
      ixorigueLotId: lot.ixorigueLotId,
    });
    await assignAnimalToIxorigueLot(ranch.ixorigueRanchId, lot, animal.ixorigueAnimalId);
    await markAnimalSyncedAfterLotAssignment(animal._id, animal.ixorigueAnimalId);
    await finalizeSyncJob("animal", animal._id, "done", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection("animals").updateOne({ _id: animal._id }, { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } });
    await finalizeSyncJob("animal", animal._id, "failed", message);
  }
}

export async function syncAnimalWeight(
  weightDoc: AnimalWeightDoc,
  animal: AnimalDoc,
  ranch: RanchDoc,
  options: { defaultTag?: string; defaultTitle?: string } = {},
) {
  if (!ranch.ixorigueRanchId || !animal.ixorigueAnimalId) {
    throw new Error("Missing upstream Ixorigue ranch or animal id");
  }

  await recordSyncJob({ entityType: "animal_weight", entityId: weightDoc._id, action: "weight", status: "running" });
  const db = await getDb();
  try {
    const remoteWeight = await addAnimalWeight({
      ixorigueRanchId: ranch.ixorigueRanchId,
      ixorigueAnimalId: animal.ixorigueAnimalId,
      weight: weightDoc.weight,
      measuredAt: weightDoc.measuredAt.toISOString(),
      tag: options.defaultTag,
      title: options.defaultTitle,
    });
    await db.collection("animal_weights").updateOne(
      { _id: weightDoc._id },
      { $set: { ixorigueWeightId: remoteWeight.id, syncStatus: "synced", syncError: null, updatedAt: new Date() } },
    );
    await db.collection("animals").updateOne({ _id: animal._id }, { $set: { currentWeight: weightDoc.weight, updatedAt: new Date() } });
    await finalizeSyncJob("animal_weight", weightDoc._id, "done", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection("animal_weights").updateOne(
      { _id: weightDoc._id },
      { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } },
    );
    await finalizeSyncJob("animal_weight", weightDoc._id, "failed", message);
  }
}

async function upsertRemoteLot(db: Awaited<ReturnType<typeof getDb>>, ranch: RanchDoc, remoteLot: IxorigueLotDto) {
  const existing = await db.collection<LotDoc>("lots").findOne({
    ranchId: ranch._id,
    ixorigueLotId: remoteLot.id,
  });

  const now = new Date();
  const nextDoc: Omit<LotDoc, "_id"> = {
    ranchId: ranch._id,
    farmId: ranch._id,
    name: remoteLot.name?.trim() || existing?.name || remoteLot.id,
    ixorigueLotId: remoteLot.id,
    geometry: remoteLot.geometry ?? existing?.geometry ?? null,
    syncStatus: "synced",
    syncError: null,
    createdByAdminUserId: existing?.createdByAdminUserId ?? ranch.createdByAdminUserId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existing) {
    await db.collection<LotDoc>("lots").updateOne({ _id: existing._id }, { $set: nextDoc });
    return { created: false, lotId: existing._id };
  }

  const result = await db.collection<LotDoc>("lots").insertOne(nextDoc as LotDoc);
  return { created: true, lotId: result.insertedId };
}

export async function syncRemoteLots(ranch: RanchDoc): Promise<RemoteSyncSummary> {
  if (!ranch.ixorigueRanchId) {
    throw new Error("Ranch missing ixorigueRanchId");
  }

  await recordSyncJob({ entityType: "ranch", entityId: ranch._id, action: "sync_pull", status: "running" });
  const db = await getDb();

  try {
    const remoteLots = await getLotsByRanch(ranch.ixorigueRanchId);
    let created = 0;
    let updated = 0;

    for (const remoteLot of remoteLots) {
      if (!remoteLot.id) {
        continue;
      }

      const result = await upsertRemoteLot(db, ranch, remoteLot);
      if (result.created) {
        created += 1;
      } else {
        updated += 1;
      }
    }

    await db.collection<RanchDoc>("ranches").updateOne(
      { _id: ranch._id },
      { $set: { syncStatus: "synced", syncError: null, updatedAt: new Date() } },
    );
    await finalizeSyncJob("ranch", ranch._id, "done", null);

    return {
      pulled: remoteLots.length,
      created,
      updated,
      skipped: Math.max(remoteLots.length - created - updated, 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection<RanchDoc>("ranches").updateOne(
      { _id: ranch._id },
      { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } },
    );
    await finalizeSyncJob("ranch", ranch._id, "failed", message);
    throw error;
  }
}

async function buildLotLookup(db: Awaited<ReturnType<typeof getDb>>, ranchId: ObjectId) {
  const lots = await db.collection<LotDoc>("lots").find({ ranchId }).toArray();
  return new Map(lots.filter((lot) => lot.ixorigueLotId).map((lot) => [lot.ixorigueLotId as string, lot]));
}

async function upsertRemoteAnimal(
  db: Awaited<ReturnType<typeof getDb>>,
  ranch: RanchDoc,
  remoteAnimal: IxorigueAnimalDto,
  lotsByRemoteId: Map<string, LotDoc>,
) {
  const lot = remoteAnimal.lotId ? lotsByRemoteId.get(remoteAnimal.lotId) : null;
  if (!lot) {
    return { skipped: true, created: false };
  }

  const existing = await db.collection<AnimalDoc>("animals").findOne({
    ranchId: ranch._id,
    ixorigueAnimalId: remoteAnimal.id,
  });

  const now = new Date();
  const currentWeight = remoteAnimal.lastWeight?.weight ?? remoteAnimal.currentWeight ?? existing?.currentWeight ?? existing?.initialWeight ?? 0;
  const nextDoc: Omit<AnimalDoc, "_id"> = {
    ranchId: ranch._id,
    farmId: ranch._id,
    lotId: lot._id,
    ixorigueAnimalId: remoteAnimal.id,
    specie: remoteAnimal.specie?.trim() || existing?.specie || "cow",
    sex: remoteAnimal.sex?.trim() || existing?.sex || "unknown",
    breed: remoteAnimal.race?.trim() || existing?.breed || "unknown",
    color: existing?.color ?? "",
    brandNumber: existing?.brandNumber ?? "",
    earTagNumber: remoteAnimal.earTag?.trim() || existing?.earTagNumber || remoteAnimal.id,
    initialWeight: existing?.initialWeight ?? currentWeight ?? 0,
    currentWeight,
    lifeStatus: remoteAnimal.isActive === false ? "dead" : existing?.lifeStatus ?? "alive",
    photoStorageKey: existing?.photoStorageKey ?? "",
    photoStorageProvider: existing?.photoStorageProvider ?? "local",
    photoStorageBucket: existing?.photoStorageBucket ?? null,
    photoStorageUrl: existing?.photoStorageUrl ?? null,
    videoStorageKey: existing?.videoStorageKey ?? null,
    videoStorageProvider: existing?.videoStorageProvider ?? null,
    videoStorageBucket: existing?.videoStorageBucket ?? null,
    videoStorageUrl: existing?.videoStorageUrl ?? null,
    lastKnownCoordinates: remoteAnimal.coordinates
      ? {
          lat: remoteAnimal.coordinates.lat,
          lng: remoteAnimal.coordinates.lng,
          recordedAt: asDate(remoteAnimal.coordinates.recordedAt) ?? existing?.lastKnownCoordinates?.recordedAt ?? now,
        }
      : existing?.lastKnownCoordinates ?? null,
    syncStatus: "synced",
    syncError: null,
    createdByAdminUserId: existing?.createdByAdminUserId ?? ranch.createdByAdminUserId,
    tag: existing?.tag ?? remoteAnimal.earTag ?? null,
    name: remoteAnimal.name ?? existing?.name ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existing) {
    await db.collection<AnimalDoc>("animals").updateOne({ _id: existing._id }, { $set: nextDoc });
    return { skipped: false, created: false };
  }

  await db.collection<AnimalDoc>("animals").insertOne(nextDoc as AnimalDoc);
  return { skipped: false, created: true };
}

export async function syncRemoteAnimals(ranch: RanchDoc): Promise<RemoteSyncSummary> {
  if (!ranch.ixorigueRanchId) {
    throw new Error("Ranch missing ixorigueRanchId");
  }

  await recordSyncJob({ entityType: "ranch", entityId: ranch._id, action: "sync_pull", status: "running" });
  const db = await getDb();

  try {
    const lotsByRemoteId = await buildLotLookup(db, ranch._id);
    const remoteAnimals = await getAnimalsByRanch(ranch.ixorigueRanchId);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const remoteAnimal of remoteAnimals) {
      if (!remoteAnimal.id) {
        skipped += 1;
        continue;
      }

      const result = await upsertRemoteAnimal(db, ranch, remoteAnimal, lotsByRemoteId);
      if (result.skipped) {
        skipped += 1;
      } else if (result.created) {
        created += 1;
      } else {
        updated += 1;
      }
    }

    await db.collection<RanchDoc>("ranches").updateOne(
      { _id: ranch._id },
      { $set: { syncStatus: "synced", syncError: null, updatedAt: new Date() } },
    );
    await finalizeSyncJob("ranch", ranch._id, "done", null);

    return {
      pulled: remoteAnimals.length,
      created,
      updated,
      skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection<RanchDoc>("ranches").updateOne(
      { _id: ranch._id },
      { $set: { syncStatus: "failed", syncError: message, updatedAt: new Date() } },
    );
    await finalizeSyncJob("ranch", ranch._id, "failed", message);
    throw error;
  }
}

export async function syncRemoteRanchStructure(ranch: RanchDoc) {
  const lots = await syncRemoteLots(ranch);
  const animals = await syncRemoteAnimals(ranch);
  return { lots, animals };
}
