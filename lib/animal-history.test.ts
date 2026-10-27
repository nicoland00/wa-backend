import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { buildWeightHistory, isVideoImport } from "@/lib/animal-history";
import type { AnimalWeightDoc } from "@/lib/db/types";

const animalId = new ObjectId();
const animal = { _id: animalId, initialWeight: 0, currentWeight: 500, createdAt: new Date("2026-01-01") };

function measurement(weight: number, measuredAt: string, createdAt = measuredAt): AnimalWeightDoc {
  return {
    _id: new ObjectId(), animalId, weight, measuredAt: new Date(measuredAt),
    createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
    source: "admin", syncStatus: "pending", syncError: null,
  };
}

describe("animal weight timeline", () => {
  it("shows +200 kg from May 15 to August 17 regardless of insertion order", () => {
    const history = buildWeightHistory(animal, [
      measurement(500, "2026-08-17"), measurement(300, "2026-05-15", "2026-10-27"),
    ]);
    expect(history[0]).toMatchObject({ weight: 500, deltaKg: 200, previousWeight: 300 });
    expect(history[0].previousMeasuredAt).toBe("2026-05-15T00:00:00.000Z");
    expect(history[1].deltaKg).toBeNull();
  });

  it("recalculates both neighboring comparisons when a backdated weighing is inserted", () => {
    const history = buildWeightHistory(animal, [
      measurement(300, "2026-05-15"), measurement(500, "2026-08-17"), measurement(350, "2026-07-01", "2026-09-01"),
    ]);
    expect(history.map((row) => row.deltaKg)).toEqual([150, 50, null]);
  });

  it("distinguishes loss, unchanged weight and a first measurement", () => {
    const history = buildWeightHistory(animal, [
      measurement(300, "2026-05-15"), measurement(280, "2026-06-01"), measurement(280, "2026-07-01"),
    ]);
    expect(history.map((row) => row.deltaKg)).toEqual([0, -20, null]);
  });

  it("keeps decimal differences precise and deterministically orders measurements on the same day", () => {
    const earlier = measurement(300.1, "2026-05-15", "2026-05-15T08:00:00Z");
    const later = measurement(300.3, "2026-05-15", "2026-05-15T09:00:00Z");
    expect(buildWeightHistory(animal, [later, earlier])[0].deltaKg).toBe(0.2);
  });

  it("uses a known registration weight as baseline only before real measurements", () => {
    expect(buildWeightHistory({ ...animal, initialWeight: 200 }, [measurement(300, "2026-05-15")])[0].deltaKg).toBe(100);
    const recordedBeforeRegistration = measurement(180, "2025-12-01");
    expect(buildWeightHistory({ ...animal, initialWeight: 200 }, [recordedBeforeRegistration])).toHaveLength(1);
  });

  it("does not invent a date for an undated legacy current weight", () => {
    expect(buildWeightHistory({ ...animal, initialWeight: 200 }, [])).toEqual([]);
  });

  it("does not duplicate an initial weight already recorded during animal creation", () => {
    const history = buildWeightHistory({ ...animal, initialWeight: 200 }, [measurement(200, "2026-01-01T00:00:01Z")]);
    expect(history).toHaveLength(1);
    expect(history[0].deltaKg).toBeNull();
  });

  it("ignores invalid dates and invalid weight values", () => {
    expect(buildWeightHistory(animal, [measurement(0, "2026-05-15"), measurement(-5, "2026-05-15"), measurement(300, "invalid")])).toEqual([]);
  });
});

it("recognizes video uploads with legacy missing MIME types", () => {
  expect(isVideoImport({ filename: "animal.MOV", mimeType: null })).toBe(true);
  expect(isVideoImport({ filename: "animal.txt", mimeType: "text/plain" })).toBe(false);
});
