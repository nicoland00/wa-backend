import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { uploadFormFile } from "@/lib/server/media";
import { serializeAnimal } from "@/lib/server/serializers";
import { deleteAnimal } from "@/lib/ixorigue/client";
import { syncAnimalUpdate } from "@/lib/server/sync";
import { objectIdSchema } from "@/lib/validators/common";
import { animalPatchSchema } from "@/lib/validators/animals";
import type { AnimalDoc, LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid animal id" }, { status: 400 });
  }

  const db = await getDb();
  const animal = await db.collection<AnimalDoc>("animals").findOne({ _id: new ObjectId(parsedId.data) });
  if (!animal) {
    return NextResponse.json({ error: "Animal not found" }, { status: 404 });
  }

  return NextResponse.json({ animal: serializeAnimal(animal) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid animal id" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const before = await db.collection<AnimalDoc>("animals").findOne({ _id });
  if (!before) {
    return NextResponse.json({ error: "Animal not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") || "";
  let updateInput: Record<string, unknown>;
  let mediaPatch: Partial<AnimalDoc> = {};
  let selfieFile: File | null = null;
  let deleteSelfie = false;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    updateInput = {
      specie: formData.get("specie") || undefined,
      name: formData.get("name") || undefined,
      sex: formData.get("sex") || undefined,
      breed: formData.get("breed") || undefined,
      color: formData.get("color") || undefined,
      brandNumber: formData.get("brandNumber") || undefined,
      earTagNumber: formData.get("earTagNumber") || undefined,
      deviceId: formData.get("deviceId") || undefined,
      birthDate: formData.get("birthDate") || undefined,
      dateOfPurchase: formData.get("dateOfPurchase") || undefined,
      registerReason: formData.get("registerReason") || undefined,
      initialWeight: formData.get("initialWeight") || undefined,
      currentWeight: formData.get("currentWeight") || undefined,
      lifeStatus: formData.get("lifeStatus") || undefined,
      lotId: formData.get("lotId") || undefined,
      ixorigueAnimalId: formData.get("ixorigueAnimalId") || undefined,
      syncStatus: formData.get("syncStatus") || undefined,
      syncError: formData.get("syncError") || undefined,
    };
    deleteSelfie = formData.get("deleteSelfie") === "true";

    const photo = formData.get("photo");
    const video = formData.get("video");
    const [uploadedPhoto, uploadedVideo] = await Promise.all([
      photo instanceof File && photo.size > 0 ? uploadFormFile(photo) : Promise.resolve(null),
      video instanceof File && video.size > 0 ? uploadFormFile(video) : Promise.resolve(null),
    ]);
    selfieFile = photo instanceof File && photo.size > 0 ? photo : null;

    if (uploadedPhoto) {
      mediaPatch = {
        ...mediaPatch,
        photoStorageKey: uploadedPhoto.key,
        photoStorageProvider: uploadedPhoto.provider,
        photoStorageBucket: uploadedPhoto.bucket ?? null,
        photoStorageUrl: uploadedPhoto.url ?? null,
      };
    }

    if (uploadedVideo) {
      mediaPatch = {
        ...mediaPatch,
        videoStorageKey: uploadedVideo.key,
        videoStorageProvider: uploadedVideo.provider,
        videoStorageBucket: uploadedVideo.bucket ?? null,
        videoStorageUrl: uploadedVideo.url ?? null,
      };
    }
  } else {
    updateInput = await request.json();
  }

  const parsed = animalPatchSchema.safeParse(updateInput);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const nextLotId = parsed.data.lotId ? new ObjectId(parsed.data.lotId) : before.lotId;
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: nextLotId });
  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  await db.collection<AnimalDoc>("animals").updateOne(
    { _id },
    {
      $set: {
        ...parsed.data,
        ...mediaPatch,
        lotId: nextLotId,
        ranchId: ranch._id,
        farmId: ranch._id,
        updatedAt: new Date(),
      },
    },
  );

  const after = await db.collection<AnimalDoc>("animals").findOne({ _id });
  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.animal.update",
    target: { type: "animal", id: parsedId.data },
    before,
    after,
  });

  if (after) {
    await syncAnimalUpdate(after, ranch, lot, { selfieFile, deleteSelfie });
  }

  const refreshed = await db.collection<AnimalDoc>("animals").findOne({ _id });
  return NextResponse.json({ animal: refreshed ? serializeAnimal(refreshed) : null });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid animal id" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const animal = await db.collection<AnimalDoc>("animals").findOne({ _id });
  if (!animal) {
    return NextResponse.json({ error: "Animal not found" }, { status: 404 });
  }

  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: animal.ranchId });
  if (ranch?.ixorigueRanchId && animal.ixorigueAnimalId) {
    try {
      await deleteAnimal(ranch.ixorigueRanchId, animal.ixorigueAnimalId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Failed to delete animal in Ixorigue: ${msg}` },
        { status: 502 },
      );
    }
  }

  await db.collection("animal_weights").deleteMany({ animalId: _id });
  await db.collection<AnimalDoc>("animals").deleteOne({ _id });

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.animal.delete",
    target: { type: "animal", id: parsedId.data },
    before: animal,
  });

  return NextResponse.json({ ok: true });
}
