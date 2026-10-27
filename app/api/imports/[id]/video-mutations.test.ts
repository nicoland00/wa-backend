import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import type { AnimalDoc, AnimalWeightDoc, ImportDoc } from "@/lib/db/types";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(), getDb: vi.fn(), deleteStoredFile: vi.fn(),
  lockVideoImport: vi.fn(), unlockVideoImport: vi.fn(), recomputeAnimalCurrentWeight: vi.fn(),
  logAudit: vi.fn(), syncAnimalWeight: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/server/auth", () => ({ requireSessionUser: mocks.requireSessionUser, isAdmin: (user: { role: string }) => user.role === "admin" }));
vi.mock("@/lib/storage", () => ({ deleteStoredFile: mocks.deleteStoredFile, getSignedDownloadUrl: vi.fn() }));
vi.mock("@/lib/server/sync", () => ({ syncAnimalWeight: mocks.syncAnimalWeight }));
vi.mock("@/lib/server/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("@/lib/server/import-history", () => ({ enrichImports: vi.fn() }));
vi.mock("@/lib/server/animal-updates", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/animal-updates")>(),
  lockVideoImport: mocks.lockVideoImport,
  unlockVideoImport: mocks.unlockVideoImport,
  recomputeAnimalCurrentWeight: mocks.recomputeAnimalCurrentWeight,
}));

import { POST as assignVideo, DELETE as detachVideo } from "./assign-animal/route";
import { DELETE as deleteVideo } from "./route";

const importId = new ObjectId();
const animalId = new ObjectId();
const lotId = new ObjectId();
const ranchId = new ObjectId();
const measuredAt = new Date("2026-08-17T00:00:00.000Z");
let item: ImportDoc;
let animal: AnimalDoc;
let weights: Map<string, AnimalWeightDoc>;
let videos: { key?: string; importId?: ObjectId }[];
const collections = {
  imports: { insertOne: vi.fn(), findOne: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn() },
  animals: { find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn(), updateMany: vi.fn() },
  animal_weights: { findOne: vi.fn(), updateOne: vi.fn(), updateMany: vi.fn(), deleteOne: vi.fn(), deleteMany: vi.fn() },
  ranches: { findOne: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  item = {
    _id: importId, ranchId, lotId, animalId: null, filename: "animal.mp4", mimeType: "video/mp4",
    storage: { provider: "gridfs", key: "video-file-id" }, createdAt: new Date("2026-08-18"),
    assignedAt: null, weightId: null, weight: null, measuredAt: null,
  } as ImportDoc;
  animal = { _id: animalId, ranchId, lotId, currentWeight: 300, initialWeight: 300, ixorigueAnimalId: null } as AnimalDoc;
  weights = new Map();
  videos = [];
  mocks.requireSessionUser.mockResolvedValue({ role: "admin", userId: new ObjectId().toString() });
  mocks.getDb.mockResolvedValue({ collection: (name: keyof typeof collections) => collections[name] });
  mocks.lockVideoImport.mockImplementation(async () => ({ item, token: "operation-token" }));
  collections.imports.findOne.mockImplementation(async (query) => query._id?.$ne ? null : item);
  collections.imports.updateOne.mockImplementation(async (_query, update) => { Object.assign(item, update.$set ?? {}); return { matchedCount: 1 }; });
  collections.animals.findOne.mockImplementation(async () => animal);
  collections.animals.find.mockImplementation((query) => ({ toArray: async () => animal.videoStorageKey === query.videoStorageKey ? [animal] : [] }));
  collections.animals.updateOne.mockImplementation(async (_query, update) => {
    Object.assign(animal, update.$set ?? {});
    const video = update.$addToSet?.videos;
    if (video && !videos.some((existing) => JSON.stringify(existing) === JSON.stringify(video))) videos.push(video);
    return { matchedCount: 1 };
  });
  collections.animals.updateMany.mockImplementation(async (_query, update) => {
    const alternatives = update.$pull?.videos?.$or ?? [];
    videos = videos.filter((video) => !alternatives.some((condition: { key?: string; importId?: ObjectId | { $exists: boolean } }) => {
      if (condition.key !== undefined && condition.key !== video.key) return false;
      if (condition.importId instanceof ObjectId) return condition.importId.equals(video.importId);
      if (condition.importId && "$exists" in condition.importId) return (video.importId !== undefined) === condition.importId.$exists;
      return true;
    }));
  });
  collections.animal_weights.updateOne.mockImplementation(async (query, update) => {
    const key = query._id.toString();
    if (weights.has(key)) return { upsertedCount: 0 };
    weights.set(key, { _id: query._id, ...update.$setOnInsert });
    return { upsertedCount: 1 };
  });
  collections.animal_weights.findOne.mockImplementation(async (query) => weights.get(query._id.toString()) ?? null);
  collections.animal_weights.updateMany.mockImplementation(async (_query, update) => {
    for (const weight of weights.values()) if (weight.importId?.equals(importId)) Object.assign(weight, update.$set);
  });
  collections.ranches.findOne.mockResolvedValue({ _id: ranchId, ixorigueRanchId: null });
});

function context() { return { params: Promise.resolve({ id: importId.toString() }) }; }
function assignmentRequest(payload: unknown = { animalId: animalId.toString(), weight: 500, measuredAt: measuredAt.toISOString() }) {
  return new NextRequest(`http://localhost/api/imports/${importId}/assign-animal`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
}
function deleteRequest() { return new NextRequest(`http://localhost/api/imports/${importId}`, { method: "DELETE" }); }

describe("video mutation access and validation", () => {
  it.each([assignVideo, detachVideo, deleteVideo])("requires a session before touching data", async (route) => {
    mocks.requireSessionUser.mockResolvedValue(null);
    const response = await route(assignmentRequest(), context());
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([assignVideo, detachVideo, deleteVideo])("rejects a non-admin before touching data", async (route) => {
    mocks.requireSessionUser.mockResolvedValue({ role: "retail", userId: "owner" });
    const response = await route(assignmentRequest(), context());
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([
    { animalId: animalId.toString(), measuredAt: measuredAt.toISOString() },
    { animalId: animalId.toString(), weight: 500 },
    { animalId: animalId.toString(), weight: 0, measuredAt: measuredAt.toISOString() },
  ])("rejects missing or invalid weighing information before any writes", async (payload) => {
    const response = await assignVideo(assignmentRequest(payload), context());
    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.lockVideoImport).not.toHaveBeenCalled();
  });

  it.each(["ranchId"] as const)("rejects an animal from another %s before mutation", async (field) => {
    animal[field] = new ObjectId();
    const response = await assignVideo(assignmentRequest(), context());
    expect(response.status).toBe(400);
    expect(mocks.lockVideoImport).not.toHaveBeenCalled();
    expect(collections.imports.updateOne).not.toHaveBeenCalled();
    expect(collections.animal_weights.updateOne).not.toHaveBeenCalled();
  });
});

describe("cross-lot paired records", () => {
  it("accepts another lot in the same ranch", async () => {
    animal.lotId = new ObjectId();
    expect((await assignVideo(assignmentRequest(), context())).status).toBe(200);
    expect(weights.size).toBe(1);
  });
  it("adds the joint record to another animal without moving the original assignment", async () => {
    const originalAnimalId = new ObjectId();
    item.animalId = originalAnimalId; item.weight = 500; item.measuredAt = measuredAt;
    let copy: ImportDoc | null = null;
    collections.imports.findOne.mockImplementation(async (query) => query._id instanceof ObjectId && query._id.equals(importId) ? item : null);
    collections.imports.insertOne.mockImplementation(async (record) => { copy = record; return { insertedId: record._id }; });
    collections.imports.updateOne.mockImplementation(async (_query, update) => { Object.assign(copy!, update.$set ?? {}); return { matchedCount: 1 }; });
    mocks.lockVideoImport.mockImplementation(async () => ({ item: copy, token: "copy-token" }));
    animal.lotId = new ObjectId();
    expect((await assignVideo(assignmentRequest(), context())).status).toBe(200);
    expect(item.animalId).toEqual(originalAnimalId);
    expect(collections.imports.insertOne).toHaveBeenCalledWith(expect.objectContaining({ storage: item.storage, weight: 500, measuredAt }));
    expect([...weights.values()][0].animalId).toEqual(animalId);
    expect([...weights.values()][0].importId).not.toEqual(importId);
  });
  it("rejects changing the weighing of a saved video/weight object", async () => {
    item.weight = 300; item.measuredAt = measuredAt;
    expect((await assignVideo(assignmentRequest(), context())).status).toBe(400);
    expect(collections.animal_weights.updateOne).not.toHaveBeenCalled();
  });
});

describe("video assignment retries and deletion", () => {
  it("reuses the same weighing and video reference when the same request is retried", async () => {
    expect((await assignVideo(assignmentRequest(), context())).status).toBe(200);
    const firstWeightId = item.weightId!.toString();
    expect((await assignVideo(assignmentRequest(), context())).status).toBe(200);
    expect(item.weightId!.toString()).toBe(firstWeightId);
    expect(weights.size).toBe(1);
    expect(videos).toHaveLength(1);
    expect([...weights.values()][0].measuredAt).toEqual(measuredAt);
  });

  it("deletes video bytes and references while preserving every weighing", async () => {
    item.animalId = animalId;
    item.weightId = new ObjectId();
    animal.videoStorageKey = item.storage.key;
    videos = [{ key: item.storage.key, importId }, { key: "different-video", importId: new ObjectId() }];
    weights.set(item.weightId.toString(), { _id: item.weightId, animalId, importId, weight: 500, measuredAt } as AnimalWeightDoc);
    const response = await deleteVideo(deleteRequest(), context());
    expect(response.status).toBe(200);
    expect(mocks.deleteStoredFile).toHaveBeenCalledWith(item.storage);
    expect(collections.imports.deleteOne).toHaveBeenCalledWith({ _id: importId, mutationToken: "operation-token" });
    expect(videos).toEqual([{ key: "different-video", importId: expect.any(ObjectId) }]);
    expect(animal.videoStorageKey).toBeNull();
    expect(weights.size).toBe(1);
    expect([...weights.values()][0]).toMatchObject({ weight: 500, measuredAt, importId: null });
    expect(collections.animal_weights.deleteOne).not.toHaveBeenCalled();
    expect(collections.animal_weights.deleteMany).not.toHaveBeenCalled();
    expect(mocks.unlockVideoImport).toHaveBeenCalled();
  });

  it("retains shared file bytes when another import still uses them", async () => {
    const survivingImportId = new ObjectId();
    item.animalId = animalId;
    animal.videoStorageKey = item.storage.key;
    videos = [{ key: item.storage.key, importId }, { key: item.storage.key, importId: survivingImportId }];
    collections.imports.findOne.mockImplementation(async (query) => query._id?.$ne ? { _id: new ObjectId(), storage: item.storage } : item);
    const response = await deleteVideo(deleteRequest(), context());
    expect(response.status).toBe(200);
    expect(mocks.deleteStoredFile).not.toHaveBeenCalled();
    expect(collections.imports.deleteOne).toHaveBeenCalledTimes(1);
    expect(videos).toEqual([{ key: item.storage.key, importId: survivingImportId }]);
    expect(animal.videoStorageKey).toBe(item.storage.key);
  });

  it("keeps the library record if deleting the stored file fails", async () => {
    mocks.deleteStoredFile.mockRejectedValue(new Error("storage unavailable"));
    const response = await deleteVideo(deleteRequest(), context());
    expect(response.status).toBe(500);
    expect(collections.imports.deleteOne).not.toHaveBeenCalled();
    expect(collections.animals.updateMany).not.toHaveBeenCalled();
    expect(mocks.unlockVideoImport).toHaveBeenCalled();
  });
});
