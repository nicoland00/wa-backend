import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { ixorigueRawGet } from "@/lib/ixorigue/client";
import type { AnimalDoc, DevicePingDoc, RanchDoc } from "@/lib/db/types";

let indexEnsured = false;

async function ensureIndex() {
  if (indexEnsured) return;
  const db = await getDb();
  // Dedupe: one ping per (animal, report time). Repeated polls of the same
  // unchanged lastLocationTimestamp collapse into a single record.
  await db.collection<DevicePingDoc>("device_pings").createIndex(
    { ixorigueAnimalId: 1, recordedAt: 1 },
    { unique: true },
  );
  await db.collection<DevicePingDoc>("device_pings").createIndex({ ranchId: 1, recordedAt: -1 });
  indexEnsured = true;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

type RawAnimal = Record<string, unknown>;

/** Pull the raw animal list and unwrap whatever envelope Ixorigue uses. */
function extractList(payload: unknown): RawAnimal[] {
  if (Array.isArray(payload)) return payload as RawAnimal[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "items", "results", "animals"]) {
      if (Array.isArray(obj[key])) return obj[key] as RawAnimal[];
    }
  }
  return [];
}

export type CaptureResult = {
  ranchId: string;
  fetched: number;
  inserted: number;
  skippedNoTimestamp: number;
  unmatched: number;
};

/**
 * Poll Ixorigue for the latest location of every animal in a ranch and store a
 * ping per (animal, report time). Idempotent thanks to the unique index.
 */
export async function captureDevicePings(ranch: RanchDoc): Promise<CaptureResult> {
  await ensureIndex();
  const db = await getDb();

  const result: CaptureResult = {
    ranchId: ranch._id.toString(),
    fetched: 0,
    inserted: 0,
    skippedNoTimestamp: 0,
    unmatched: 0,
  };

  if (!ranch.ixorigueRanchId) return result;

  const raw = await ixorigueRawGet(`/api/Animals/${ranch.ixorigueRanchId}`);
  const list = extractList(raw);
  result.fetched = list.length;

  // Map Ixorigue animal id -> local animal _id
  const localAnimals = await db
    .collection<AnimalDoc>("animals")
    .find({ ranchId: ranch._id, ixorigueAnimalId: { $ne: null } })
    .project<{ _id: ObjectId; ixorigueAnimalId: string }>({ _id: 1, ixorigueAnimalId: 1 })
    .toArray();
  const localByIxId = new Map(localAnimals.map((a) => [a.ixorigueAnimalId, a._id]));

  const now = new Date();
  const docs: DevicePingDoc[] = [];

  for (const entry of list) {
    const source = (entry.data && typeof entry.data === "object" ? entry.data : entry) as RawAnimal;
    const ixId = str(source.id) ?? str(source.animalId);
    const ts = str(source.lastLocationTimestamp);
    if (!ixId) continue;
    if (!ts) {
      result.skippedNoTimestamp += 1;
      continue;
    }
    const localId = localByIxId.get(ixId);
    if (!localId) {
      result.unmatched += 1;
      continue;
    }

    const loc = (source.lastLocation && typeof source.lastLocation === "object" ? source.lastLocation : {}) as RawAnimal;
    const device = (source.device && typeof source.device === "object" ? source.device : {}) as RawAnimal;

    docs.push({
      _id: new ObjectId(),
      ranchId: ranch._id,
      animalId: localId,
      ixorigueAnimalId: ixId,
      recordedAt: new Date(ts),
      lat: num(loc.latitude),
      lng: num(loc.longitude),
      isLowAccuracy: bool(loc.isLowAccuracy),
      battery: num(device.battery),
      deviceSerial: str(device.serialNumber),
      deviceDisabled: bool(device.disabled),
      capturedAt: now,
    });
  }

  // Insert, ignoring duplicates (same animal + recordedAt already stored).
  if (docs.length > 0) {
    try {
      const res = await db.collection<DevicePingDoc>("device_pings").insertMany(docs, { ordered: false });
      result.inserted = res.insertedCount;
    } catch (err) {
      // Duplicate-key errors are expected when the report time hasn't changed.
      const e = err as { code?: number; result?: { insertedCount?: number }; insertedCount?: number };
      result.inserted = e.result?.insertedCount ?? e.insertedCount ?? 0;
      if (e.code !== 11000 && !(e as { writeErrors?: unknown }).writeErrors) {
        throw err;
      }
    }
  }

  return result;
}

export async function captureAllRanchDevicePings(): Promise<CaptureResult[]> {
  const db = await getDb();
  const ranches = await db
    .collection<RanchDoc>("ranches")
    .find({ ixorigueRanchId: { $ne: null } })
    .toArray();
  const results: CaptureResult[] = [];
  for (const ranch of ranches) {
    try {
      results.push(await captureDevicePings(ranch));
    } catch (err) {
      results.push({
        ranchId: ranch._id.toString(),
        fetched: 0,
        inserted: 0,
        skippedNoTimestamp: 0,
        unmatched: 0,
        ...(err instanceof Error ? { error: err.message } : {}),
      } as CaptureResult);
    }
  }
  return results;
}
