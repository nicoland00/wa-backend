import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { getAnimalPath, ixorigueRawGet } from "@/lib/ixorigue/client";
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

type SlotStatus = "ok" | "missing" | "future" | "no-device";

/** Build 48 local-time slots from pings already filtered to the selected local date. */
function buildSlots(localSlots: number[], dateStr: string): SlotStatus[] {
  const now = localNow();
  const isToday = dateStr === now.date;
  const currentSlot = isToday ? now.slot : TOTAL_SLOTS - 1;

  const filled = new Set(localSlots);
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    if (i > currentSlot) return "future";
    return filled.has(i) ? "ok" : "missing";
  });
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

  // A ranch-local day (GMT-4) spans two UTC days, so fetch both and keep only
  // the points whose local date matches the selected day.
  const utcDay = dateStr; // local 04:00..24:00 falls on this UTC day
  const utcDayNext = nextDay(dateStr); // local 00:00..04:00 falls on the next UTC day
  const pathResults = await Promise.allSettled(
    animals.map(async (animal) => {
      if (!ranch.ixorigueRanchId || !animal.ixorigueAnimalId) {
        return { animalId: animal._id.toString(), pings: [] as string[] };
      }
      const [a, b] = await Promise.all([
        getAnimalPath(ranch.ixorigueRanchId, animal.ixorigueAnimalId, utcDay),
        getAnimalPath(ranch.ixorigueRanchId, animal.ixorigueAnimalId, utcDayNext),
      ]);
      const pings = [...a, ...b]
        .filter((p) => p.recordedAt)
        .map((p) => p.recordedAt as string)
        .filter((iso) => localParts(iso).date === dateStr);
      return { animalId: animal._id.toString(), pings };
    }),
  );

  const pingsByAnimal = new Map<string, string[]>();
  for (const result of pathResults) {
    if (result.status === "fulfilled") {
      pingsByAnimal.set(result.value.animalId, result.value.pings);
    }
  }

  // Count how many active slots exist (past + current) for expected count
  const now = localNow();
  const isToday = dateStr === now.date;
  const currentSlot = isToday ? now.slot : TOTAL_SLOTS - 1;
  const expectedSlots = currentSlot + 1;

  // Build per-lot structure
  const lotAnimalsMap = new Map<string, DeviceHealthAnimal[]>();
  for (const lot of lots) lotAnimalsMap.set(lot._id.toString(), []);

  const unassigned: DeviceHealthAnimal[] = [];

  for (const animal of animals) {
    const pings = pingsByAnimal.get(animal._id.toString()) ?? [];
    const hasDevice = !!(ranch.ixorigueRanchId && animal.ixorigueAnimalId);
    const localSlots = pings.map((iso) => localParts(iso).slot);
    const slots: SlotStatus[] = hasDevice
      ? buildSlots(localSlots, dateStr)
      : Array(TOTAL_SLOTS).fill("no-device" as SlotStatus);

    const sortedPings = [...pings].sort();
    const entry: DeviceHealthAnimal = {
      id: animal._id.toString(),
      earTagNumber: animal.earTagNumber,
      name: animal.name ?? animal.tag ?? null,
      deviceId: animal.deviceId ?? null,
      ixorigueAnimalId: animal.ixorigueAnimalId,
      slots,
      pingCount: pings.length,
      totalExpected: hasDevice ? expectedSlots : 0,
      lastPingAt: sortedPings[sortedPings.length - 1] ?? null,
      lastKnownAt: animal.lastKnownCoordinates?.recordedAt
        ? new Date(animal.lastKnownCoordinates.recordedAt).toISOString()
        : null,
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

  const totalPingsFetched = [...pingsByAnimal.values()].reduce((sum, p) => sum + p.length, 0);
  const pathErrors = pathResults.filter((r) => r.status === "rejected").length;

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
      totalPingsFetched,
      pathErrors,
    },
  });
}
