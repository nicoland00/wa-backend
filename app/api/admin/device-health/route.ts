import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { getAnimalsLocations, ixorigueRawGet } from "@/lib/ixorigue/client";
import { objectIdSchema } from "@/lib/validators/common";
import { ObjectId } from "mongodb";
import type { AnimalDoc, LotDoc, RanchDoc } from "@/lib/db/types";

const SLOT_MINUTES = 30;
const TOTAL_SLOTS = (24 * 60) / SLOT_MINUTES; // 48
// Ranch local timezone: GMT-4. Ixorigue returns UTC ISO timestamps; we bucket
// them by local wall clock so the bars read in ranch time.
const TZ_OFFSET_MIN = -4 * 60;

/** Local (ranch-time) wall clock for a UTC ISO string. */
function localParts(isoString: string): { date: string; slot: number } {
  const shifted = new Date(new Date(isoString).getTime() + TZ_OFFSET_MIN * 60_000);
  const date = shifted.toISOString().slice(0, 10);
  const slot = Math.floor((shifted.getUTCHours() * 60 + shifted.getUTCMinutes()) / SLOT_MINUTES);
  return { date, slot };
}

function localNow(): { date: string; slot: number } {
  return localParts(new Date().toISOString());
}

/** UTC ms at the start of local slot `i` on `dateStr` (GMT-4). */
function slotStartUtcMs(dateStr: string, i: number): number {
  return Date.parse(`${dateStr}T00:00:00Z`) - TZ_OFFSET_MIN * 60_000 + i * SLOT_MINUTES * 60_000;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Expected number of reporting slots for a local date (full day, partial today, 0 future). */
function expectedSlotsForDate(dateStr: string): number {
  const now = localNow();
  if (dateStr > now.date) return 0;
  if (dateStr === now.date) return now.slot + 1;
  return TOTAL_SLOTS;
}

type SlotStatus = "ok" | "missing" | "future" | "no-device";

/** Build 48 local-time slots for a single day from the set of slot indices that had a ping. */
function buildSlots(localSlots: Set<number>, dateStr: string): SlotStatus[] {
  const now = localNow();
  const isToday = dateStr === now.date;
  const currentSlot = isToday ? now.slot : TOTAL_SLOTS - 1;
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    if (i > currentSlot) return "future";
    return localSlots.has(i) ? "ok" : "missing";
  });
}

export type DeviceHealthDay = {
  date: string;
  pingCount: number; // distinct half-hour slots that reported
  expected: number;
  pct: number; // 0..100
};

export type DeviceHealthAnimal = {
  id: string;
  earTagNumber: string;
  name: string | null;
  deviceId: string | null;
  ixorigueAnimalId: string | null;
  hasDevice: boolean;
  slots: SlotStatus[] | null; // day mode only
  days: DeviceHealthDay[]; // per-day buckets across the range
  overallPingCount: number;
  overallExpected: number;
  overallPct: number;
  lastPingAt: string | null;
  lastKnownAt: string | null;
  battery: number | null;
  deviceSerial: string | null;
  deviceDisabled: boolean | null;
};

export type DeviceHealthLot = {
  id: string;
  name: string;
  animals: DeviceHealthAnimal[];
};

type RangeMode = "day" | "week" | "month";

export async function GET(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewAdminScreens(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const parsedRanchId = objectIdSchema.safeParse(searchParams.get("ranchId"));
  if (!parsedRanchId.success) return NextResponse.json({ error: "Invalid ranchId" }, { status: 400 });

  const modeParam = searchParams.get("range");
  const mode: RangeMode = modeParam === "week" || modeParam === "month" ? modeParam : "day";
  const endDate = searchParams.get("end") ?? localNow().date; // local YYYY-MM-DD, inclusive
  const span = mode === "month" ? 30 : mode === "week" ? 7 : 1;
  const startDate = addDays(endDate, -(span - 1));

  // Local dates in the range, oldest first.
  const dates: string[] = [];
  for (let i = 0; i < span; i++) dates.push(addDays(startDate, i));

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(parsedRanchId.data) });
  if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });

  const [lots, animals] = await Promise.all([
    db.collection<LotDoc>("lots").find({ ranchId: ranch._id }).sort({ name: 1 }).toArray(),
    db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id, lifeStatus: "alive" }).sort({ earTagNumber: 1 }).toArray(),
  ]);

  // One Ixorigue call covers the whole range (local day -> UTC window).
  const fromIso = new Date(slotStartUtcMs(startDate, 0)).toISOString();
  const toIso = new Date(slotStartUtcMs(endDate, 0) + 24 * 60 * 60 * 1000).toISOString();

  let history: Awaited<ReturnType<typeof getAnimalsLocations>> = [];
  if (ranch.ixorigueRanchId) {
    try {
      history = await getAnimalsLocations(ranch.ixorigueRanchId, fromIso, toIso);
    } catch {
      history = [];
    }
  }

  // Per Ixorigue animal: date -> set of half-hour slots that reported; last ping time.
  const byIxId = new Map<string, { slotsByDate: Map<string, Set<number>>; lastPingAt: string | null }>();
  for (const h of history) {
    if (!h.animalId) continue;
    const slotsByDate = new Map<string, Set<number>>();
    let lastTs: string | null = null;
    for (const loc of h.locations) {
      const lp = localParts(loc.timestamp);
      if (lp.date < startDate || lp.date > endDate) continue;
      (slotsByDate.get(lp.date) ?? slotsByDate.set(lp.date, new Set()).get(lp.date)!).add(lp.slot);
      if (!lastTs || loc.timestamp > lastTs) lastTs = loc.timestamp;
    }
    byIxId.set(h.animalId, { slotsByDate, lastPingAt: lastTs });
  }

  // Battery / serial / disabled from the current animal list (one raw call).
  const devByIxId = new Map<string, { battery: number | null; serial: string | null; disabled: boolean | null }>();
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
        devByIxId.set(ixId, {
          battery: typeof dev.battery === "number" ? dev.battery : null,
          serial: typeof dev.serialNumber === "string" ? dev.serialNumber : null,
          disabled: typeof dev.disabled === "boolean" ? dev.disabled : null,
        });
      }
    } catch {
      // battery best-effort
    }
  }

  const expectedByDate = new Map(dates.map((d) => [d, expectedSlotsForDate(d)]));

  const lotAnimalsMap = new Map<string, DeviceHealthAnimal[]>();
  for (const lot of lots) lotAnimalsMap.set(lot._id.toString(), []);
  const unassigned: DeviceHealthAnimal[] = [];

  for (const animal of animals) {
    const ixId = animal.ixorigueAnimalId;
    const hasDevice = !!(ranch.ixorigueRanchId && ixId);
    const hist = ixId ? byIxId.get(ixId) : undefined;

    const days: DeviceHealthDay[] = dates.map((date) => {
      const expected = expectedByDate.get(date) ?? 0;
      const pingCount = hist?.slotsByDate.get(date)?.size ?? 0;
      const pct = expected > 0 ? Math.round((pingCount / expected) * 100) : 0;
      return { date, pingCount, expected, pct };
    });

    const overallPingCount = days.reduce((s, d) => s + d.pingCount, 0);
    const overallExpected = days.reduce((s, d) => s + d.expected, 0);
    const overallPct = hasDevice && overallExpected > 0 ? Math.round((overallPingCount / overallExpected) * 100) : 0;

    const dev = ixId ? devByIxId.get(ixId) : undefined;
    const entry: DeviceHealthAnimal = {
      id: animal._id.toString(),
      earTagNumber: animal.earTagNumber,
      name: animal.name ?? animal.tag ?? null,
      deviceId: animal.deviceId ?? null,
      ixorigueAnimalId: ixId,
      hasDevice,
      slots: mode === "day" && hasDevice ? buildSlots(hist?.slotsByDate.get(endDate) ?? new Set(), endDate) : null,
      days,
      overallPingCount,
      overallExpected,
      overallPct,
      lastPingAt: hist?.lastPingAt ?? null,
      lastKnownAt: animal.lastKnownCoordinates?.recordedAt
        ? new Date(animal.lastKnownCoordinates.recordedAt).toISOString()
        : null,
      battery: dev?.battery ?? null,
      deviceSerial: dev?.serial ?? null,
      deviceDisabled: dev?.disabled ?? null,
    };

    const lotKey = animal.lotId.toString();
    if (lotAnimalsMap.has(lotKey)) lotAnimalsMap.get(lotKey)!.push(entry);
    else unassigned.push(entry);
  }

  const result: DeviceHealthLot[] = lots
    .filter((lot) => (lotAnimalsMap.get(lot._id.toString()) ?? []).length > 0)
    .map((lot) => ({ id: lot._id.toString(), name: lot.name, animals: lotAnimalsMap.get(lot._id.toString()) ?? [] }));
  if (unassigned.length > 0) result.push({ id: "unassigned", name: "Sin lote", animals: unassigned });

  return NextResponse.json({
    mode,
    startDate,
    endDate,
    dates,
    slotMinutes: SLOT_MINUTES,
    ranchId: ranch._id.toString(),
    ranchName: ranch.name,
    lots: result,
  });
}
