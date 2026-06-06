import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { resolveStoredMediaUrl } from "@/lib/server/media";
import { serializeAnimal } from "@/lib/server/serializers";
import type { AnimalDoc, ImportDoc, RanchDoc } from "@/lib/db/types";

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

  // Videos assigned to each animal come straight from the imports collection. Oldest first.
  const animalIds = animals.map((a) => a._id);
  const videoImports = animalIds.length
    ? await db.collection<ImportDoc>("imports")
        .find({ animalId: { $in: animalIds } })
        .sort({ createdAt: 1 })
        .toArray()
    : [];
  const videoImportsByAnimal = new Map<string, ImportDoc[]>();
  for (const item of videoImports) {
    if (!item.animalId) continue;
    const isVideo = item.mimeType?.startsWith("video/") || item.filename.endsWith(".mp4");
    if (!isVideo) continue;
    const key = item.animalId.toString();
    (videoImportsByAnimal.get(key) ?? videoImportsByAnimal.set(key, []).get(key)!).push(item);
  }

  const enriched = await Promise.all(
    animals.map(async (animal) => {
      const videos = (
        await Promise.all(
          (videoImportsByAnimal.get(animal._id.toString()) ?? []).map(async (item) => ({
            url: await resolveStoredMediaUrl(item.storage),
            filename: item.filename,
          })),
        )
      ).filter((v): v is { url: string; filename: string } => !!v.url);

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
      };
    }),
  );

  return NextResponse.json({ animals: enriched });
}
