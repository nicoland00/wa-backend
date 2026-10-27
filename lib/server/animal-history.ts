import type { Db } from "mongodb";
import { buildWeightHistory, isVideoImport } from "@/lib/animal-history";
import type { AnimalDoc, AnimalVideoRef, AnimalWeightDoc, ImportDoc, StoredMediaRef } from "@/lib/db/types";
import { resolveStoredMediaUrl } from "@/lib/server/media";
import { serializeAnimal } from "@/lib/server/serializers";

function mediaIdentity(storage: StoredMediaRef) {
  return `${storage.provider}:${storage.bucket ?? ""}:${storage.key}`;
}

type HistoryVideo = {
  _id: string;
  importId: string | null;
  url: string | null;
  filename: string;
  createdAt: Date | null;
  measuredAt: Date | string | null;
  weight: number | null;
  deltaKg: number | null;
  weightInherited?: boolean;
};

/** One shared projection keeps cards, detail views and video lists consistent. */
export async function enrichAnimals(db: Db, animals: AnimalDoc[], providedImports?: ImportDoc[]) {
  if (!animals.length) return [];
  const animalIds = animals.map((animal) => animal._id);
  const [weights, imports] = await Promise.all([
    db.collection<AnimalWeightDoc>("animal_weights").find({ animalId: { $in: animalIds } }).toArray(),
    providedImports ?? db.collection<ImportDoc>("imports").find({ animalId: { $in: animalIds } }).toArray(),
  ]);
  const weightsByAnimal = new Map<string, AnimalWeightDoc[]>();
  const importsByAnimal = new Map<string, ImportDoc[]>();
  for (const weight of weights) {
    const key = weight.animalId.toString();
    const group = weightsByAnimal.get(key) ?? [];
    group.push(weight);
    weightsByAnimal.set(key, group);
  }
  for (const item of imports) {
    if (!item.animalId || !isVideoImport(item)) continue;
    const key = item.animalId.toString();
    const group = importsByAnimal.get(key) ?? [];
    group.push(item);
    importsByAnimal.set(key, group);
  }

  return Promise.all(animals.map(async (animal) => {
    const weightHistory = buildWeightHistory(animal, weightsByAnimal.get(animal._id.toString()) ?? []);
    const animalImports = importsByAnimal.get(animal._id.toString()) ?? [];
    const importedStorage = new Set(animalImports.map((item) => mediaIdentity(item.storage)));
    const importedIds = new Set(animalImports.map((item) => item._id.toString()));
    const legacyByStorage = new Map<string, AnimalVideoRef>();
    for (const ref of animal.videos ?? []) {
      if (!ref.key || importedStorage.has(mediaIdentity(ref)) || (ref.importId && importedIds.has(ref.importId.toString()))) continue;
      legacyByStorage.set(mediaIdentity(ref), ref);
    }
    if (animal.videoStorageKey) {
      const ref: AnimalVideoRef = {
        key: animal.videoStorageKey,
        provider: animal.videoStorageProvider ?? "local",
        bucket: animal.videoStorageBucket ?? undefined,
        url: animal.videoStorageUrl ?? undefined,
      };
      if (!importedStorage.has(mediaIdentity(ref)) && !legacyByStorage.has(mediaIdentity(ref))) legacyByStorage.set(mediaIdentity(ref), ref);
    }

    const importedVideos: HistoryVideo[] = await Promise.all(animalImports.map(async (item) => {
      const linkedWeight = weightHistory.find((weight) =>
        weight.importId === item._id.toString() || weight._id === item.weightId?.toString());
      return {
        _id: item._id.toString(),
        importId: item._id.toString(),
        url: await resolveStoredMediaUrl(item.storage),
        filename: item.filename,
        createdAt: item.createdAt,
        measuredAt: linkedWeight?.measuredAt ?? item.measuredAt ?? item.createdAt,
        weight: linkedWeight?.weight ?? item.weight ?? weightHistory[0]?.weight ?? (animal.currentWeight > 0 ? animal.currentWeight : null),
        weightInherited: !linkedWeight && item.weight == null,
        deltaKg: linkedWeight?.deltaKg ?? null,
      };
    }));
    // Old direct animal uploads had no import record. Preserve them without
    // inventing a weighing or an upload date, or pretending the synthetic ID is
    // a deletable import. New uploads always have a real import ID.
    const legacyVideos: HistoryVideo[] = await Promise.all([...legacyByStorage.values()].map(async (ref) => ({
      _id: `legacy:${mediaIdentity(ref)}`,
      importId: ref.importId?.toString() ?? null,
      url: await resolveStoredMediaUrl(ref),
      filename: ref.key.split("/").at(-1) ?? "Vídeo del animal",
      createdAt: ref.addedAt ?? null,
      measuredAt: ref.measuredAt ?? null,
      weight: ref.weight ?? weightHistory[0]?.weight ?? (animal.currentWeight > 0 ? animal.currentWeight : null),
      weightInherited: ref.weight == null,
      deltaKg: null,
    })));
    const videos = [...importedVideos, ...legacyVideos].filter((video) => video.url !== null).sort((left, right) =>
      new Date(right.measuredAt ?? right.createdAt ?? 0).getTime() - new Date(left.measuredAt ?? left.createdAt ?? 0).getTime()
      || right._id.localeCompare(left._id));

    return {
      ...serializeAnimal(animal),
      currentWeight: weightHistory[0]?.weight ?? animal.currentWeight,
      weightHistory,
      latestWeight: weightHistory[0] ?? null,
      previousWeight: weightHistory[1] ?? null,
      weightChangeKg: weightHistory[0]?.deltaKg ?? null,
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
      coordinates: animal.lastKnownCoordinates ?? null,
    };
  }));
}
