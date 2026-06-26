import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { getAnimalsLocations, ixorigueRawGet } from "@/lib/ixorigue/client";
import { objectIdSchema } from "@/lib/validators/common";
import type { AnimalDoc, LotDoc, RanchDoc } from "@/lib/db/types";

const SLOT_MINUTES = 30;
const TOTAL_SLOTS = (24 * 60) / SLOT_MINUTES; // 48
// Ranch local timezone: GMT-4. Pings come from Ixorigue as UTC ISO strings;
// we bucket them by local wall-clock so the bar reads in ranch time.
const TZ_OFFSET_MIN = -4 * 60;

/** Local (ranch-time) wall clock for a UTC ISO string. */
function localParts(isoString: string): { date: string; slot: number } {
  const shifted = new Date(new Date(isoString).getTime() + TZ_OFFSET_MIN * 60_000);
  const date = shifted.toISOString().slice(0, 10);
  const slot = Math.floor((shifted.getUTCHours() * 60 + shifted.getUTCMinutes()) / SLOT_MINUTES);
  return { date, slot };
}

/** Current ranch-local date + slot index right now. */
function localNow(): { date: string; slot: number } {
  return localParts(new Date().toISOString());
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type SlotStatus = "ok" | "missing" | "future" | "no-device" | "no-data";

/** UTC ms at the start of local slot `i` on `dateStr` (GMT-4). */
function slotStartUtcMs(dateStr: string, i: number): number {
  // local wall time -> UTC: UTC = local - offset (offset is local-minus-UTC, i.e. -240)
  return Date.parse(`${dateStr}T00:00:00Z`) - TZ_OFFSET_MIN * 60_000 + i * SLOT_MINUTES * 60_000;
}

/**
 * Build 48 local-time slots. Slots before we began capturing are "no-data"
 * (neutral) rather than "missing" (red) — we can't claim a device failed to
 * report during a window we weren't even polling.
 */
function buildSlots(localSlots: number[], dateStr: string, coverageStartMs: number): SlotStatus[] {
  const now = localNow();
  const isToday = dateStr === now.date;
  const currentSlot = isToday ? now.slot : TOTAL_SLOTS - 1;

  const filled = new Set(localSlots);
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    if (i > currentSlot) return "future";
    if (filled.has(i)) return "ok";
    // No ping in this slot — was it within our capture coverage?
    const slotEndMs = slotStartUtcMs(dateStr, i) + SLOT_MINUTES * 60_000;
    if (slotEndMs <= coverageStartMs) return "no-data";
    return "missing";
  });
}

/** Count slots that were both in the past and within capture coverage. */
function countCoveredPastSlots(dateStr: string, coverageStartMs: number): number {
  const now = localNow();
  const isToday = dateStr === now.date;
  const currentSlot = isToday ? now.slot : TOTAL_SLOTS - 1;
  let n = 0;
  for (let i = 0; i <= currentSlot; i++) {
    const slotEndMs = slotStartUtcMs(dateStr, i) + SLOT_MINUTES * 60_000;
    if (slotEndMs > coverageStartMs) n += 1;
  }
  return n;
}

export type DeviceHealthAnimal = {
  id: string;
  earTagNumber: string;
  name: string | null;
  deviceId: string | null;
  ixorigueAnimalId: string | null;
  slots: SlotStatus[];
  pingCount: number;
  totalExpected: number;
  lastPingAt: string | null;
  /** Last synced location time from the animal record (independent of the path endpoint). */
  lastKnownAt: string | null;
  battery: number | null; // 0..1, latest known
  deviceSerial: string | null;
  deviceDisabled: boolean | null;
  lowAccuracyCount: number; // pings flagged low-accuracy on the selected day
};

export type DeviceHealthLot = {
  id: string;
  name: string;
  animals: DeviceHealthAnimal[];
};

export async function GET(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewAdminScreens(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const ranchIdRaw = searchParams.get("ranchId");
  const dateParam = searchParams.get("date"); // YYYY-MM-DD UTC

  const parsedRanchId = objectIdSchema.safeParse(ranchIdRaw);
  if (!parsedRanchId.success) {
    return NextResponse.json({ error: "Invalid ranchId" }, { status: 400 });
  }

  // Default to today in ranch-local time (GMT-4)
  const dateStr = dateParam ?? localNow().date;

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(parsedRanchId.data) });
  if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });

  const [lots, animals] = await Promise.all([
    db.collection<LotDoc>("lots").find({ ranchId: ranch._id }).sort({ name: 1 }).toArray(),
    db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id, lifeStatus: "alive" }).sort({ earTagNumber: 1 }).toArray(),
  ]);

  // Debug: probe several endpoint paths + date formats for the first animal with
  // a device, so we can find which one actually returns historical pings.
  // Prefer an animal that reported recently (so we know data SHOULD exist).
  if (searchParams.get("debug") === "raw") {
    const sample =
      animals
        .filter((a) => a.ixorigueAnimalId && a.lastKnownCoordinates?.recordedAt)
        .sort((a, b) =>
          new Date(b.lastKnownCoordinates!.recordedAt).getTime() -
          new Date(a.lastKnownCoordinates!.recordedAt).getTime(),
        )[0] ?? animals.find((a) => a.ixorigueAnimalId);

    if (!ranch.ixorigueRanchId || !sample?.ixorigueAnimalId) {
      return NextResponse.json({ error: "No animal with ixorigueAnimalId on this ranch", ranchHasIxorigueId: !!ranch.ixorigueRanchId });
    }
    const rid = ranch.ixorigueRanchId;
    const aid = sample.ixorigueAnimalId;

    // The day we KNOW has data: the date of this animal's last known fix.
    const lastFix = sample.lastKnownCoordinates?.recordedAt
      ? new Date(sample.lastKnownCoordinates.recordedAt)
      : new Date();
    const lastFixDate = lastFix.toISOString().slice(0, 10); // UTC
    const mmddyyyy = `${lastFixDate.slice(5, 7)}/${lastFixDate.slice(8, 10)}/${lastFixDate.slice(0, 4)}`;

    const probes: { label: string; path: string }[] = [
      { label: "path?date=YYYY-MM-DD", path: `/api/Animals/${rid}/${aid}/path?date=${encodeURIComponent(lastFixDate)}` },
      { label: "path?date=YYYY-MM-DDT00:00:00", path: `/api/Animals/${rid}/${aid}/path?date=${encodeURIComponent(lastFixDate + "T00:00:00")}` },
      { label: "path?date=MM/DD/YYYY", path: `/api/Animals/${rid}/${aid}/path?date=${encodeURIComponent(mmddyyyy)}` },
      { label: "path (no date)", path: `/api/Animals/${rid}/${aid}/path` },
      { label: "locations", path: `/api/Animals/${rid}/${aid}/locations` },
      { label: "history", path: `/api/Animals/${rid}/${aid}/history` },
      { label: "animalById (full doc)", path: `/api/Animals/${rid}/${aid}` },
    ];

    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          const raw = await ixorigueRawGet(probe.path);
          const arr = Array.isArray(raw)
            ? raw
            : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
              ? (raw as { data: unknown[] }).data
              : null;
          return {
            label: probe.label,
            path: probe.path,
            ok: true,
            isArray: Array.isArray(raw),
            arrayLength: arr ? arr.length : null,
            sample: arr ? arr.slice(0, 2) : raw,
          };
        } catch (err) {
          return { label: probe.label, path: probe.path, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );

    return NextResponse.json({
      sampleAnimal: {
        earTag: sample.earTagNumber,
        ixorigueAnimalId: aid,
        lastKnownFix: sample.lastKnownCoordinates?.recordedAt ?? null,
      },
      probedDate: lastFixDate,
      note: "Look for a probe with arrayLength > 0 — that endpoint/format holds the history.",
      results,
    });
  }

  // Real location history straight from Ixorigue for the selected local day.
  // A ranch-local day (GMT-4) maps to a UTC range; one call returns every animal.
  const fromMs = slotStartUtcMs(dateStr, 0);
  const toMs = fromMs + 24 * 60 * 60 * 1000;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  let history: Awaited<ReturnType<typeof getAnimalsLocations>> = [];
  if (ranch.ixorigueRanchId) {
    try {
      history = await getAnimalsLocations(ranch.ixorigueRanchId, fromIso, toIso);
    } catch {
      history = [];
    }
  }
  // Map Ixorigue animalId -> its location timestamps within the local day.
  const slotsByIxId = new Map<string, number[]>();
  const lastPingByIxId = new Map<string, string>();
  const serialByIxId = new Map<string, string | null>();
  for (const h of history) {
    if (!h.animalId) continue;
    const slots: number[] = [];
    let lastTs: string | null = null;
    for (const loc of h.locations) {
      const lp = localParts(loc.timestamp);
      if (lp.date !== dateStr) continue;
      slots.push(lp.slot);
      if (!lastTs || loc.timestamp > lastTs) lastTs = loc.timestamp;
    }
    slotsByIxId.set(h.animalId, slots);
    if (lastTs) lastPingByIxId.set(h.animalId, lastTs);
    serialByIxId.set(h.animalId, h.serialNumber);
  }

  // Battery / serial / disabled from the current animal list (one raw call).
  const batteryByIxId = new Map<string, { battery: number | null; serial: string | null; disabled: boolean | null }>();
  if (ranch.ixorigueRanchId) {
    try {
      const rawList = await ixorigueRawGet(`/api/Animals/${ranch.ixorigueRanchId}`);
      const arr = Array.isArray(rawList)
        ? rawList
        : rawList && typeof rawList === "object" && Array.isArray((rawList as { data?: unknown }).data)
          ? (rawList as { data: unknown[] }).data
          : [];
      for (const item of arr) {
        const src = (item && typeof item === "object" && "data" in (item as object) ? (item as { data: unknown }).data : item) as Record<string, unknown>;
        const ixId = typeof src.id === "string" ? src.id : null;
        if (!ixId) continue;
        const dev = (src.device && typeof src.device === "object" ? src.device : {}) as Record<string, unknown>;
        batteryByIxId.set(ixId, {
          battery: typeof dev.battery === "number" ? dev.battery : null,
          serial: typeof dev.serialNumber === "string" ? dev.serialNumber : null,
          disabled: typeof dev.disabled === "boolean" ? dev.disabled : null,
        });
      }
    } catch {
      // battery is best-effort
    }
  }

  // History is authoritative across all of time, so every past slot is real.
  const coverageStartMs = Number.NEGATIVE_INFINITY;
  const expectedSlots = countCoveredPastSlots(dateStr, coverageStartMs);

  // Build per-lot structure
  const lotAnimalsMap = new Map<string, DeviceHealthAnimal[]>();
  for (const lot of lots) lotAnimalsMap.set(lot._id.toString(), []);

  const unassigned: DeviceHealthAnimal[] = [];

  for (const animal of animals) {
    const ixId = animal.ixorigueAnimalId;
    const hasDevice = !!(ranch.ixorigueRanchId && ixId);
    const localSlots = ixId ? (slotsByIxId.get(ixId) ?? []) : [];
    const slots: SlotStatus[] = hasDevice
      ? buildSlots(localSlots, dateStr, coverageStartMs)
      : Array(TOTAL_SLOTS).fill("no-device" as SlotStatus);

    const dev = ixId ? batteryByIxId.get(ixId) : undefined;
    const entry: DeviceHealthAnimal = {
      id: animal._id.toString(),
      earTagNumber: animal.earTagNumber,
      name: animal.name ?? animal.tag ?? null,
      deviceId: animal.deviceId ?? null,
      ixorigueAnimalId: animal.ixorigueAnimalId,
      slots,
      pingCount: new Set(localSlots).size,
      totalExpected: hasDevice ? expectedSlots : 0,
      lastPingAt: ixId ? (lastPingByIxId.get(ixId) ?? null) : null,
      lastKnownAt: animal.lastKnownCoordinates?.recordedAt
        ? new Date(animal.lastKnownCoordinates.recordedAt).toISOString()
        : null,
      battery: dev?.battery ?? null,
      deviceSerial: dev?.serial ?? (ixId ? serialByIxId.get(ixId) ?? null : null),
      deviceDisabled: dev?.disabled ?? null,
      lowAccuracyCount: 0,
    };

    const lotKey = animal.lotId.toString();
    if (lotAnimalsMap.has(lotKey)) {
      lotAnimalsMap.get(lotKey)!.push(entry);
    } else {
      unassigned.push(entry);
    }
  }

  const result: DeviceHealthLot[] = lots
    .filter((lot) => (lotAnimalsMap.get(lot._id.toString()) ?? []).length > 0)
    .map((lot) => ({
      id: lot._id.toString(),
      name: lot.name,
      animals: lotAnimalsMap.get(lot._id.toString()) ?? [],
    }));

  if (unassigned.length > 0) {
    result.push({ id: "unassigned", name: "Sin lote", animals: unassigned });
  }

  const totalPingsToday = [...slotsByIxId.values()].reduce((sum, s) => sum + s.length, 0);

  return NextResponse.json({
    date: dateStr,
    ranchId: ranch._id.toString(),
    ranchName: ranch.name,
    slotMinutes: SLOT_MINUTES,
    lots: result,
    debug: {
      animalsWithIxorigueId: animals.filter((a) => a.ixorigueAnimalId).length,
      animalsTotal: animals.length,
      ranchHasIxorigueId: !!ranch.ixorigueRanchId,
      historyAnimals: history.length,
      totalLocationPointsToday: totalPingsToday,
    },
  });
}
