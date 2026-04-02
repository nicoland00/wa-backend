import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AnimalDoc, ImportDoc, LotDoc, RanchDoc, UserDoc } from "@/lib/db/types";
import type { SessionUser } from "@/lib/server/auth";

export async function getDbUser(userId: string) {
  const db = await getDb();
  return db.collection<UserDoc>("users").findOne({ _id: new ObjectId(userId) });
}

export async function getRanchById(ranchId: string | ObjectId) {
  const db = await getDb();
  const _id = typeof ranchId === "string" ? new ObjectId(ranchId) : ranchId;
  return db.collection<RanchDoc>("ranches").findOne({ _id });
}

export async function getLotById(lotId: string | ObjectId) {
  const db = await getDb();
  const _id = typeof lotId === "string" ? new ObjectId(lotId) : lotId;
  return db.collection<LotDoc>("lots").findOne({ _id });
}

export async function getAnimalById(animalId: string | ObjectId) {
  const db = await getDb();
  const _id = typeof animalId === "string" ? new ObjectId(animalId) : animalId;
  return db.collection<AnimalDoc>("animals").findOne({ _id });
}

export async function getImportById(importId: string | ObjectId) {
  const db = await getDb();
  const _id = typeof importId === "string" ? new ObjectId(importId) : importId;
  return db.collection<ImportDoc>("imports").findOne({ _id });
}

export async function userOwnsRanch(user: SessionUser, ranchId: ObjectId) {
  const ranch = await getRanchById(ranchId);
  return Boolean(ranch && ranch.ownerUserId.toString() === user.userId);
}

export async function assertRanchAccess(user: SessionUser, ranchId: ObjectId) {
  if (user.role === "admin") {
    return true;
  }
  return userOwnsRanch(user, ranchId);
}

export async function assertLotAccess(user: SessionUser, lot: LotDoc) {
  return assertRanchAccess(user, lot.ranchId ?? lot.farmId ?? lot._id);
}

export async function assertAnimalAccess(user: SessionUser, animal: AnimalDoc) {
  return assertRanchAccess(user, animal.ranchId ?? animal.farmId ?? animal._id);
}
