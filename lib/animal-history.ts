import type { AnimalDoc, AnimalWeightDoc } from "@/lib/db/types";

export type WeightHistoryRecord = {
  _id: string;
  weight: number;
  measuredAt: string;
  createdAt: string;
  source: AnimalWeightDoc["source"] | "initial";
  importId: string | null;
  deltaKg: number | null;
  previousWeight: number | null;
  previousMeasuredAt: string | null;
};

function validDate(value: Date | string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Compare measurements by their actual date, including records added retroactively. */
export function buildWeightHistory(
  animal: Pick<AnimalDoc, "_id" | "initialWeight" | "currentWeight" | "createdAt">,
  weights: AnimalWeightDoc[],
): WeightHistoryRecord[] {
  const ordered = weights.flatMap((weight) => {
    const measuredAt = validDate(weight.measuredAt);
    if (!measuredAt || !Number.isFinite(weight.weight) || weight.weight <= 0) return [];
    return [{
      _id: weight._id.toString(),
      weight: weight.weight,
      measuredAt: measuredAt.toISOString(),
      createdAt: (validDate(weight.createdAt) ?? measuredAt).toISOString(),
      source: weight.source as WeightHistoryRecord["source"],
      importId: weight.importId?.toString() ?? null,
    }];
  }).sort((left, right) =>
    left.measuredAt.localeCompare(right.measuredAt)
    || left.createdAt.localeCompare(right.createdAt)
    || left._id.localeCompare(right._id));

  const initialDate = validDate(animal.createdAt);
  // Existing animals may predate the weight collection. Only use their known
  // registration date as a baseline when it is earlier than every measurement.
  // An undated legacy current weight must not be silently replaced by a baseline.
  if (initialDate && animal.initialWeight > 0
    && ((ordered.length > 0 && ordered[0].weight !== animal.initialWeight && initialDate.toISOString() < ordered[0].measuredAt)
      || (ordered.length === 0 && animal.initialWeight === animal.currentWeight))) {
    ordered.unshift({
      _id: `initial:${animal._id.toString()}`,
      weight: animal.initialWeight,
      measuredAt: initialDate.toISOString(),
      createdAt: initialDate.toISOString(),
      source: "initial",
      importId: null,
    });
  }

  return ordered.map((record, index) => {
    const previous = ordered[index - 1];
    return {
      ...record,
      // Round floating point subtraction without discarding decimal kilograms.
      deltaKg: previous ? Number((record.weight - previous.weight).toFixed(6)) : null,
      previousWeight: previous?.weight ?? null,
      previousMeasuredAt: previous?.measuredAt ?? null,
    };
  }).reverse();
}

export function isVideoImport(item: { mimeType?: string | null; filename: string }) {
  return Boolean(item.mimeType?.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(item.filename));
}
