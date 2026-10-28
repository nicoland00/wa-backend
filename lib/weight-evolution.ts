type Measurement = { weight: number; measuredAt: string };

/** Compare the original weight with the latest dated weight, never the extrema. */
export function getWeightEvolution(records: Measurement[], initialWeight?: number, currentWeight?: number) {
  const validWeight = (value?: number): value is number => value != null && Number.isFinite(value) && value > 0;
  const sorted = records.filter((record) => validWeight(record.weight) && Number.isFinite(new Date(record.measuredAt).getTime()))
    .slice().sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());
  const initial = validWeight(initialWeight) ? initialWeight : sorted.at(-1)?.weight ?? null;
  const latest = sorted[0]?.weight ?? (validWeight(currentWeight) ? currentWeight : null);
  const difference = initial != null && latest != null ? Number((latest - initial).toFixed(6)) : null;
  const percentage = difference != null && initial != null ? difference / initial * 100 : null;
  return { initial, latest, difference, percentage };
}
