import type { Db } from "mongodb";
import { buildWeightHistory, isVideoImport } from "@/lib/animal-history";
import type { AnimalDoc, AnimalWeightDoc, ImportDoc } from "@/lib/db/types";
import { resolveStoredMediaUrl } from "@/lib/server/media";
import { serializeImport } from "@/lib/server/serializers";

/** Annotate video records against each animal's complete weighing timeline. */
export async function enrichImports(db: Db, imports: ImportDoc[]) {
  if (!imports.length) return [];
  const idsByValue = new Map(imports.flatMap((item) => item.animalId ? [[item.animalId.toString(), item.animalId] as const] : []));
  const animalIds = [...idsByValue.values()];
  const [animals, weights] = animalIds.length ? await Promise.all([
    db.collection<AnimalDoc>("animals").find({ _id: { $in: animalIds } }).toArray(),
    db.collection<AnimalWeightDoc>("animal_weights").find({ animalId: { $in: animalIds } }).toArray(),
  ]) : [[], []];
  const weightsByAnimal = new Map<string, AnimalWeightDoc[]>();
  for (const weight of weights) {
    const key = weight.animalId.toString();
    const rows = weightsByAnimal.get(key) ?? [];
    rows.push(weight);
    weightsByAnimal.set(key, rows);
  }
  const historyByAnimal = new Map(animals.map((animal) => [
    animal._id.toString(), buildWeightHistory(animal, weightsByAnimal.get(animal._id.toString()) ?? []),
  ]));

  const animalById = new Map(animals.map((animal) => [animal._id.toString(), animal]));

  return Promise.all(imports.map(async (item) => {
    const history = item.animalId ? historyByAnimal.get(item.animalId.toString()) : undefined;
    const linked = history?.find((weight) => weight.importId === item._id.toString() || weight._id === item.weightId?.toString());
    return {
      ...serializeImport(item),
      weightId: linked?._id ?? item.weightId?.toString() ?? null,
      measuredAt: linked?.measuredAt ?? item.measuredAt ?? null,
      weight: linked?.weight ?? item.weight ?? (item.animalId ? history?.[0]?.weight ?? animalById.get(item.animalId.toString())?.currentWeight : null) ?? null,
      weightInherited: !linked && item.weight == null,
      deltaKg: linked?.deltaKg ?? null,
      previousWeight: linked?.previousWeight ?? null,
      previousMeasuredAt: linked?.previousMeasuredAt ?? null,
      videoUrl: isVideoImport(item) ? await resolveStoredMediaUrl(item.storage) : null,
    };
  }));
}
