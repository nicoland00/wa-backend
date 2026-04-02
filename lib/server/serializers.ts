import type {
  AnimalDoc,
  AnimalWeightDoc,
  AuditLogDoc,
  DataErrorRequestDoc,
  ImportDoc,
  LotDoc,
  RanchDoc,
  SyncJobDoc,
  UserDoc,
} from "@/lib/db/types";

export function serializeUser(user: UserDoc) {
  return {
    ...user,
    _id: user._id.toString(),
  };
}

export function serializeRanch(ranch: RanchDoc) {
  return {
    ...ranch,
    _id: ranch._id.toString(),
    ownerUserId: ranch.ownerUserId.toString(),
    createdByAdminUserId: ranch.createdByAdminUserId.toString(),
  };
}

export function serializeLot(lot: LotDoc) {
  return {
    ...lot,
    _id: lot._id.toString(),
    ranchId: (lot.ranchId ?? lot.farmId)?.toString(),
    createdByAdminUserId: lot.createdByAdminUserId.toString(),
  };
}

export function serializeAnimal(animal: AnimalDoc) {
  return {
    ...animal,
    _id: animal._id.toString(),
    ranchId: (animal.ranchId ?? animal.farmId)?.toString(),
    lotId: animal.lotId.toString(),
    createdByAdminUserId: animal.createdByAdminUserId.toString(),
  };
}

export function serializeAnimalWeight(weight: AnimalWeightDoc) {
  return {
    ...weight,
    _id: weight._id.toString(),
    animalId: weight.animalId.toString(),
    ixorigueWeightId: weight.ixorigueWeightId ?? null,
  };
}

export function serializeImport(item: ImportDoc) {
  return {
    ...item,
    _id: item._id.toString(),
    ranchId: (item.ranchId ?? item.farmId)?.toString(),
    lotId: item.lotId ? item.lotId.toString() : null,
  };
}

export function serializeSyncJob(job: SyncJobDoc) {
  return {
    ...job,
    _id: job._id.toString(),
    entityId: job.entityId.toString(),
  };
}

export function serializeDataErrorRequest(item: DataErrorRequestDoc) {
  return {
    ...item,
    _id: item._id.toString(),
    ranchId: item.ranchId ? item.ranchId.toString() : null,
    lotId: item.lotId ? item.lotId.toString() : null,
    animalId: item.animalId ? item.animalId.toString() : null,
    reportedByUserId: item.reportedByUserId.toString(),
    resolvedByAdminUserId: item.resolvedByAdminUserId ? item.resolvedByAdminUserId.toString() : null,
  };
}

export function serializeAuditLog(item: AuditLogDoc) {
  return {
    ...item,
    _id: item._id.toString(),
    actorUserId: item.actorUserId.toString(),
  };
}
