import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { resolveStoredMediaUrl } from "@/lib/server/media";
import { serializeAnimal } from "@/lib/server/serializers";
import type { AnimalDoc, AnimalWeightDoc, RanchDoc } from "@/lib/db/types";

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

  const animalIds = animals.map((a) => a._id);
  const weightDocs = animalIds.length
    ? await db.collection<AnimalWeightDoc>("animal_weights")
        .find({ animalId: { $in: animalIds } })
        .sort({ measuredAt: 1, createdAt: 1 })
        .toArray()
    : [];
  const weightsByAnimal = new Map<string, AnimalWeightDoc[]>();
  for (const w of weightDocs) {
    const key = w.animalId.toString();
    (weightsByAnimal.get(key) ?? weightsByAnimal.set(key, []).get(key)!).push(w);
  }

  const enriched = await Promise.all(
    animals.map(async (animal) => {
      const videoRefs = animal.videos?.length
        ? animal.videos
        : animal.videoStorageKey
          ? [{
              provider: animal.videoStorageProvider ?? "local",
              bucket: animal.videoStorageBucket ?? undefined,
              key: animal.videoStorageKey,
              url: animal.videoStorageUrl ?? undefined,
            }]
          : [];

      const videos = (
        await Promise.all(
          videoRefs.map(async (ref) => ({
            url: await resolveStoredMediaUrl(ref),
            addedAt: "addedAt" in ref && ref.addedAt ? ref.addedAt : null,
          })),
        )
      ).filter((v): v is { url: string; addedAt: Date | null } => !!v.url);

      const recorded = weightsByAnimal.get(animal._id.toString()) ?? [];
      const weights = [
        { weight: animal.initialWeight ?? 0, recordedAt: animal.createdAt ?? null, initial: true },
        ...recorded.map((w) => ({ weight: w.weight, recordedAt: w.measuredAt ?? w.createdAt ?? null, initial: false })),
      ];

      return {
        ...serializeAnimal(animal),
        photoUrl: animal.photoStorageKey
          ? await resolveStoredMediaUrl({
              provider: animal.photoStorageProvider ?? "local",
              bucket: animal.photoStorageBucket ?? undefined,
              key: animal.photoStorageKey,
              url: animal.photoStorageUrl ?? undefined,
            })
          : null,
        videoUrl: videos[0]?.url ?? null,
        videos,
        weights,
      };
    }),
  );

  return NextResponse.json({ animals: enriched });
}
