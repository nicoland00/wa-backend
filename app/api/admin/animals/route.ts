import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { uploadFormFile } from "@/lib/server/media";
import { serializeAnimal } from "@/lib/server/serializers";
import { syncAnimalCreate, syncLotCreate } from "@/lib/server/sync";
import { animalBaseSchema } from "@/lib/validators/animals";
import type { AnimalDoc, LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const lotId = request.nextUrl.searchParams.get("lotId");
  const ranchId = request.nextUrl.searchParams.get("ranchId");
  const filter: Record<string, unknown> = {};
  if (lotId && ObjectId.isValid(lotId)) {
    filter.lotId = new ObjectId(lotId);
  }
  if (ranchId && ObjectId.isValid(ranchId)) {
    filter.ranchId = new ObjectId(ranchId);
  }
  const db = await getDb();
  const animals = await db.collection<AnimalDoc>("animals").find(filter).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ animals: animals.map(serializeAnimal) });
}

export async function POST(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const parsed = animalBaseSchema.safeParse({
    lotId: formData.get("lotId"),
    specie: formData.get("specie"),
    name: formData.get("name"),
    sex: formData.get("sex"),
    breed: formData.get("breed"),
    color: formData.get("color"),
    brandNumber: formData.get("brandNumber"),
    earTagNumber: formData.get("earTagNumber"),
    deviceId: formData.get("deviceId"),
    initialWeight: formData.get("initialWeight"),
    birthDate: formData.get("birthDate"),
    dateOfPurchase: formData.get("dateOfPurchase"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const photoFile = formData.get("photo");
  const videoFile = formData.get("video");

  const db = await getDb();
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(parsed.data.lotId) });
  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }
  if (!ranch.ixorigueRanchId) {
    return NextResponse.json({ error: "Selected ranch is not linked to Ixorigue." }, { status: 400 });
  }

  let syncedLot = lot;
  if (!syncedLot.ixorigueLotId) {
    await syncLotCreate(syncedLot, ranch);
    const refreshedLot = await db.collection<LotDoc>("lots").findOne({ _id: syncedLot._id });
    if (!refreshedLot?.ixorigueLotId) {
      return NextResponse.json(
        { error: refreshedLot?.syncError ?? "Selected lot is not synced to Ixorigue yet. Sync the lot first." },
        { status: 400 },
      );
    }
    syncedLot = refreshedLot;
  }

  const [photo, video] = await Promise.all([
    photoFile instanceof File && photoFile.size > 0 ? uploadFormFile(photoFile) : Promise.resolve(null),
    videoFile instanceof File && videoFile.size > 0 ? uploadFormFile(videoFile) : Promise.resolve(null),
  ]);

  const now = new Date();
  const birthDate = parsed.data.birthDate ? new Date(parsed.data.birthDate) : null;
  const dateOfPurchase = parsed.data.dateOfPurchase ? new Date(parsed.data.dateOfPurchase) : null;
  const registerReason = birthDate ? "birth" : "purchase";
  const animal: Omit<AnimalDoc, "_id"> = {
    ranchId: ranch._id,
    farmId: ranch._id,
    lotId: lot._id,
    ixorigueAnimalId: null,
    specie: parsed.data.specie,
    sex: parsed.data.sex,
    breed: parsed.data.breed ?? "",
    color: parsed.data.color ?? "",
    brandNumber: parsed.data.brandNumber ?? "",
    earTagNumber: parsed.data.earTagNumber,
    deviceId: parsed.data.deviceId ?? null,
    registerReason,
    birthDate,
    dateOfPurchase,
    initialWeight: parsed.data.initialWeight ?? 0,
    currentWeight: parsed.data.initialWeight ?? 0,
    lifeStatus: "alive",
    photoStorageKey: photo?.key ?? "",
    photoStorageProvider: photo?.provider,
    photoStorageBucket: photo?.bucket ?? null,
    photoStorageUrl: photo?.url ?? null,
    videoStorageKey: video?.key ?? null,
    videoStorageProvider: video?.provider ?? null,
    videoStorageBucket: video?.bucket ?? null,
    videoStorageUrl: video?.url ?? null,
    lastKnownCoordinates: null,
    syncStatus: "pending",
    syncError: null,
    createdByAdminUserId: new ObjectId(actor.userId),
    tag: parsed.data.earTagNumber,
    name: parsed.data.name,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection<AnimalDoc>("animals").insertOne(animal as AnimalDoc);
  const created = await db.collection<AnimalDoc>("animals").findOne({ _id: result.insertedId });
  if (!created) {
    return NextResponse.json({ error: "Failed to create animal" }, { status: 500 });
  }

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.animal.create",
    target: { type: "animal", id: created._id.toString() },
    after: created,
  });

  await syncAnimalCreate(created, ranch, syncedLot, {
    selfieFile: photoFile instanceof File && photoFile.size > 0 ? photoFile : null,
  });
  const refreshed = await db.collection<AnimalDoc>("animals").findOne({ _id: created._id });
  if (!refreshed) {
    return NextResponse.json({ error: "Animal sync result missing" }, { status: 500 });
  }
  if (refreshed.syncStatus !== "synced" || !refreshed.ixorigueAnimalId) {
    return NextResponse.json(
      { error: refreshed.syncError ?? "Animal was created locally but could not be synced to Ixorigue.", animal: serializeAnimal(refreshed) },
      { status: 400 },
    );
  }
  return NextResponse.json({ animal: serializeAnimal(refreshed) }, { status: 201 });
}
