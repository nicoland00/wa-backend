import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { AnimalDoc, AnimalWeightDoc, ImportDoc } from "@/lib/db/types";
import { enrichAnimals } from "@/lib/server/animal-history";
import { enrichImports } from "@/lib/server/import-history";

vi.mock("@/lib/server/media", () => ({ resolveStoredMediaUrl: async () => "/video.mp4" }));

const animalId = new ObjectId();
const importId = new ObjectId();
const weightId = new ObjectId();
const animal = {
  _id: animalId, lotId: new ObjectId(), ranchId: new ObjectId(),
  initialWeight: 0, currentWeight: 300, photoStorageKey: "", createdAt: new Date("2026-01-01"),
} as AnimalDoc;
const weights = [
  { _id: new ObjectId(), animalId, weight: 300, measuredAt: new Date("2026-05-15"), createdAt: new Date("2026-05-15"), source: "admin" },
  { _id: weightId, animalId, weight: 500, measuredAt: new Date("2026-08-17"), createdAt: new Date("2026-08-17"), source: "admin", importId },
] as AnimalWeightDoc[];
const video = {
  _id: importId, animalId, lotId: animal.lotId, ranchId: animal.ranchId,
  filename: "animal.mp4", mimeType: "video/mp4", storage: { key: "video", provider: "local" },
  createdAt: new Date("2026-10-27"), weightId,
} as ImportDoc;

function database(records: { animal_weights: AnimalWeightDoc[]; animals: AnimalDoc[]; imports: ImportDoc[] }) {
  const find = vi.fn((name: keyof typeof records) => ({ find: () => ({ toArray: async () => records[name] }) }));
  return { db: { collection: find } as unknown as Db, find };
}

describe("shared animal and import projection", () => {
  it("shows the same dated comparison in animal cards and videos with batched database reads", async () => {
    const { db, find } = database({ animal_weights: weights, animals: [animal], imports: [video] });
    const [card] = await enrichAnimals(db, [animal]);
    const [importView] = await enrichImports(db, [video]);
    expect(card.currentWeight).toBe(500);
    expect(card.weightChangeKg).toBe(200);
    expect(card.videos[0]).toMatchObject({ weight: 500, deltaKg: 200, measuredAt: "2026-08-17T00:00:00.000Z" });
    expect(importView).toMatchObject({ weight: 500, deltaKg: 200, previousWeight: 300, measuredAt: "2026-08-17T00:00:00.000Z" });
    expect(find).toHaveBeenCalledTimes(4);
  });

  it("keeps a weighing in the history after its video has been deleted", async () => {
    const { db } = database({ animal_weights: weights, animals: [animal], imports: [] });
    const [card] = await enrichAnimals(db, [animal]);
    expect(card.videos).toEqual([]);
    expect(card.weightHistory).toHaveLength(2);
    expect(card.currentWeight).toBe(500);
    expect(card.weightChangeKg).toBe(200);
  });

  it("does not invent weight or comparison values for an old video with no weighing", async () => {
    const { db } = database({ animal_weights: [], animals: [animal], imports: [video] });
    const [importView] = await enrichImports(db, [video]);
    expect(importView.weight).toBeNull();
    expect(importView.deltaKg).toBeNull();
    expect(importView.measuredAt).toBeNull();
  });

  it("preserves legacy direct videos without inventing dates or comparisons", async () => {
    const { db } = database({ animal_weights: [], animals: [animal], imports: [] });
    const [card] = await enrichAnimals(db, [{ ...animal, videoStorageKey: "old.mp4", videoStorageProvider: "local" }]);
    expect(card.videos).toHaveLength(1);
    expect(card.videos[0]).toMatchObject({ _id: "legacy:local::old.mp4", importId: null, weight: null, measuredAt: null, createdAt: null, deltaKg: null });
  });

  it("deduplicates legacy arrays, primary pointer and the corresponding video import", async () => {
    const { db } = database({ animal_weights: [], animals: [animal], imports: [video] });
    const [card] = await enrichAnimals(db, [{
      ...animal, videoStorageKey: "video", videoStorageProvider: "local",
      videos: [{ provider: "local", key: "video", addedAt: new Date("2026-10-27") }],
    }]);
    expect(card.videos).toHaveLength(1);
    expect(card.videos[0].importId).toBe(importId.toString());
  });
});
