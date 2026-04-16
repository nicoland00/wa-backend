import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { resolveStoredMediaUrl } from "@/lib/server/media";
import { serializeAnimal, serializeImport, serializeLot, serializeRanch } from "@/lib/server/serializers";
import { objectIdSchema } from "@/lib/validators/common";
import type { AnimalDoc, ImportDoc, LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid ranch id" }, { status: 400 });
  }

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(parsedId.data) });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }
  if (!canViewAdminScreens(user) && ranch.ownerUserId.toString() !== user.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [lots, animals, imports] = await Promise.all([
    db.collection<LotDoc>("lots").find({ ranchId: ranch._id }).sort({ name: 1 }).toArray(),
    db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id }).sort({ earTagNumber: 1, createdAt: -1 }).toArray(),
    db.collection<ImportDoc>("imports").find({ ranchId: ranch._id }).sort({ createdAt: -1 }).toArray(),
  ]);

  const serializedAnimals = await Promise.all(
    animals.map(async (animal) => ({
      ...serializeAnimal(animal),
      photoUrl: animal.photoStorageKey
        ? await resolveStoredMediaUrl({
            provider: animal.photoStorageProvider ?? "local",
            bucket: animal.photoStorageBucket ?? undefined,
            key: animal.photoStorageKey,
            url: animal.photoStorageUrl ?? undefined,
          })
        : null,
      videoUrl: animal.videoStorageKey
        ? await resolveStoredMediaUrl({
            provider: animal.videoStorageProvider ?? "local",
            bucket: animal.videoStorageBucket ?? undefined,
            key: animal.videoStorageKey,
            url: animal.videoStorageUrl ?? undefined,
          })
        : null,
      coordinates: animal.lastKnownCoordinates ?? null,
    })),
  );

  return NextResponse.json({
    ranch: serializeRanch(ranch),
    lots: lots.map((lot) => ({
      ...serializeLot(lot),
      animalCount: animals.filter((animal) => animal.lotId.toString() === lot._id.toString()).length,
    })),
    animals: serializedAnimals,
    importsByLot: imports.map(serializeImport),
  });
}
