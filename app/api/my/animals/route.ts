import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { resolveStoredMediaUrl } from "@/lib/server/media";
import { serializeAnimal } from "@/lib/server/serializers";
import type { AnimalDoc, RanchDoc } from "@/lib/db/types";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ ownerUserId: new ObjectId(user.userId) });
  if (!ranch) {
    return NextResponse.json({ animals: [] });
  }

  const animals = await db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id }).sort({ createdAt: -1 }).toArray();
  const enriched = await Promise.all(
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
    })),
  );

  return NextResponse.json({ animals: enriched });
}
