import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  getDb: vi.fn(),
  uploadFormFile: vi.fn(),
  createAdminWeightRecord: vi.fn(),
  recomputeAnimalCurrentWeight: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/server/auth", () => ({ requireSessionUser: mocks.requireSessionUser, isAdmin: () => true }));
vi.mock("@/lib/server/media", () => ({ uploadFormFile: mocks.uploadFormFile }));
vi.mock("@/lib/server/animal-history", () => ({ enrichAnimals: async (_db: unknown, animals: unknown[]) => animals }));
vi.mock("@/lib/server/animal-records", () => ({ createAdminWeightRecord: mocks.createAdminWeightRecord, createAnimalVideoImport: vi.fn() }));
vi.mock("@/lib/server/animal-updates", () => ({ recomputeAnimalCurrentWeight: mocks.recomputeAnimalCurrentWeight }));
vi.mock("@/lib/server/sync", () => ({ syncAnimalCreate: vi.fn(), syncLotCreate: vi.fn(), syncAnimalUpdate: vi.fn(), syncAnimalWeight: vi.fn() }));
vi.mock("@/lib/server/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/ixorigue/client", () => ({ deleteAnimal: vi.fn() }));

import { POST } from "./route";
import { PATCH } from "./[id]/route";

const animalId = new ObjectId();
const lotId = new ObjectId();
const ranchId = new ObjectId();
const animals = { findOne: vi.fn(), updateOne: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionUser.mockResolvedValue({ role: "admin", userId: new ObjectId().toString() });
  animals.findOne.mockResolvedValue({ _id: animalId, lotId, ranchId, currentWeight: 500, initialWeight: 300 });
  mocks.getDb.mockResolvedValue({
    collection: (name: string) => name === "animals" ? animals : {
      findOne: vi.fn().mockResolvedValue(name === "lots" ? { _id: lotId, ranchId } : { _id: ranchId }),
    },
  });
});

function createForm() {
  const form = new FormData();
  form.set("lotId", lotId.toString());
  form.set("specie", "cow");
  form.set("sex", "female");
  form.set("earTagNumber", "ES-1234");
  form.set("birthDate", "2024-05-15");
  form.set("video", new File(["test video"], "animal.mp4", { type: "video/mp4" }));
  return form;
}

describe("direct animal video validation", () => {
  it("rejects a new animal video without its weight before uploading any files", async () => {
    const form = createForm();
    form.set("measuredAt", "2026-05-15");
    const response = await POST(new NextRequest("http://localhost/api/admin/animals", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(mocks.uploadFormFile).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects an initial weight without its video", async () => {
    const form = createForm(); form.delete("video"); form.set("initialWeight", "300"); form.set("measuredAt", "2026-05-15");
    const response = await POST(new NextRequest("http://localhost/api/admin/animals", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects a video with a weight but no measurement date", async () => {
    const form = createForm();
    form.set("initialWeight", "300");
    const response = await POST(new NextRequest("http://localhost/api/admin/animals", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(mocks.uploadFormFile).not.toHaveBeenCalled();
  });

  it("requires a date when editing a weight and leaves the existing animal untouched", async () => {
    const response = await PATCH(new NextRequest(`http://localhost/api/admin/animals/${animalId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentWeight: 500 }),
    }), { params: Promise.resolve({ id: animalId.toString() }) });
    expect(response.status).toBe(400);
    expect(animals.updateOne).not.toHaveBeenCalled();
    expect(mocks.createAdminWeightRecord).not.toHaveBeenCalled();
  });

  it("keeps an undated legacy weight intact during an ordinary metadata edit", async () => {
    const response = await PATCH(new NextRequest(`http://localhost/api/admin/animals/${animalId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Luna" }),
    }), { params: Promise.resolve({ id: animalId.toString() }) });
    expect(response.status).toBe(200);
    expect(mocks.createAdminWeightRecord).not.toHaveBeenCalled();
    expect(mocks.recomputeAnimalCurrentWeight).not.toHaveBeenCalled();
    expect(animals.updateOne.mock.calls[0][1].$set).not.toHaveProperty("currentWeight");
  });
});
