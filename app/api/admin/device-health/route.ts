import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { getAnimalPath } from "@/lib/ixorigue/client";
import { objectIdSchema } from "@/lib/validators/common";
import type { AnimalDoc, LotDoc, RanchDoc } from "@/lib/db/types";

const SLOT_MINUTES = 30;
const TOTAL_SLOTS = (24 * 60) / SLOT_MINUTES; // 48

function slotIndex(isoString: string): number {
  const d = new Date(isoString);
  return Math.floor((d.getUTCHours() * 60 + d.getUTCMinutes()) / SLOT_MINUTES);
}

type SlotStatus = "ok" | "missing" | "future" | "no-device";

function buildSlots(pingTimes: string[], dateStr: string): SlotStatus[] {
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);
  const isToday = dateStr === todayUtc;
  const currentSlot = isToday
    ? Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / SLOT_MINUTES)
    : TOTAL_SLOTS - 1;

  const filled = new Set(pingTimes.map(slotIndex));
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

  // Default to today in UTC
  const dateStr = dateParam ?? new Date().toISOString().slice(0, 10);

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(parsedRanchId.data) });
  if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });

  const [lots, animals] = await Promise.all([
    db.collection<LotDoc>("lots").find({ ranchId: ranch._id }).sort({ name: 1 }).toArray(),
    db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id, lifeStatus: "alive" }).sort({ earTagNumber: 1 }).toArray(),
  ]);

  // Fetch path points from Ixorigue for each animal that has an ixorigueAnimalId
  const pathResults = await Promise.allSettled(
    animals.map(async (animal) => {
      if (!ranch.ixorigueRanchId || !animal.ixorigueAnimalId) return { animalId: animal._id.toString(), pings: [] };
      const points = await getAnimalPath(ranch.ixorigueRanchId, animal.ixorigueAnimalId, dateStr);
      const pings = points
        .filter((p) => p.recordedAt)
        .map((p) => p.recordedAt as string);
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
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);
  const isToday = dateStr === todayUtc;
  const currentSlot = isToday
    ? Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / SLOT_MINUTES)
    : TOTAL_SLOTS - 1;
  const expectedSlots = currentSlot + 1;

  const lotMap = new Map(lots.map((l) => [l._id.toString(), l]));

  // Build per-lot structure
  const lotAnimalsMap = new Map<string, DeviceHealthAnimal[]>();
  for (const lot of lots) lotAnimalsMap.set(lot._id.toString(), []);

  const unassigned: DeviceHealthAnimal[] = [];

  for (const animal of animals) {
    const pings = pingsByAnimal.get(animal._id.toString()) ?? [];
    const hasDevice = !!(ranch.ixorigueRanchId && animal.ixorigueAnimalId);
    const slots: SlotStatus[] = hasDevice
      ? buildSlots(pings, dateStr)
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
