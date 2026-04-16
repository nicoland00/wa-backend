import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAnimalEarTags, getDevicesByRanch } from "@/lib/ixorigue/client";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import type { AnimalDoc, RanchDoc } from "@/lib/db/types";

const SPECIE_OPTIONS = [
  { value: "cow", label: "Bovino" },
  { value: "sheep", label: "Ovino" },
  { value: "goat", label: "Caprino" },
  { value: "pig", label: "Porcino" },
  { value: "horse", label: "Equino" },
  { value: "donkey", label: "Equino burro" },
] as const;

const SEX_OPTIONS = [
  { value: "female", label: "Hembra" },
  { value: "male", label: "Macho" },
  { value: "steer", label: "Buey" },
] as const;

export async function GET(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ranchId = request.nextUrl.searchParams.get("ranchId");
  if (!ranchId || !ObjectId.isValid(ranchId)) {
    return NextResponse.json({ error: "Valid ranchId is required" }, { status: 400 });
  }

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(ranchId) });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  const localAnimals = await db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id }).toArray();
  const breedsBySpecie = new Map<string, Set<string>>();

  for (const animal of localAnimals) {
    const specie = animal.specie?.trim() || "cow";
    const breed = animal.breed?.trim();
    if (!breed) {
      continue;
    }
    const bucket = breedsBySpecie.get(specie) ?? new Set<string>();
    bucket.add(breed);
    breedsBySpecie.set(specie, bucket);
  }

  let earTags: string[] = [];
  let devices: Array<{ value: string; label: string; disabled: boolean; assignedAnimalLabel: string | null }> = [];
  let remoteError: string | null = null;

  if (ranch.ixorigueRanchId) {
    try {
      const [remoteEarTags, remoteDevices] = await Promise.all([
        getAnimalEarTags(ranch.ixorigueRanchId),
        getDevicesByRanch(ranch.ixorigueRanchId),
      ]);

      earTags = remoteEarTags.map((item) => item.earTag).filter(Boolean).sort((a, b) => a.localeCompare(b));
      devices = remoteDevices
        .map((item) => ({
          value: item.id,
          label: item.serialNumber?.trim() || item.id,
          disabled: item.disabled === true || Boolean(item.animalId),
          assignedAnimalLabel: item.animalEarTag?.trim() || item.animalName?.trim() || null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (error) {
      remoteError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json({
    specieOptions: SPECIE_OPTIONS,
    sexOptions: SEX_OPTIONS,
    breedOptionsBySpecie: Object.fromEntries(
      SPECIE_OPTIONS.map(({ value }) => [value, Array.from(breedsBySpecie.get(value) ?? []).sort((a, b) => a.localeCompare(b))]),
    ),
    earTagOptions: earTags,
    deviceOptions: devices,
    remoteError,
  });
}
