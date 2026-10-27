"use client";

export type WeightRecord = {
  _id: string;
  weight: number;
  measuredAt: string;
  deltaKg: number | null;
  previousWeight: number | null;
  previousMeasuredAt: string | null;
  importId?: string | null;
  source?: string;
};

export type AnimalHistoryVideo = {
  url: string;
  filename?: string;
  importId?: string | null;
  createdAt?: string | null;
  measuredAt?: string | null;
  weight?: number | null;
  weightInherited?: boolean;
  deltaKg?: number | null;
};

export function formatWeight(value: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

export function formatRecordDate(value?: string | null) {
  if (!value) return "Fecha no registrada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no registrada";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function WeightChange({ value, className = "" }: { value?: number | null; className?: string }) {
  if (value == null) return <span className={`text-xs text-slate-500 ${className}`}>Primer pesaje</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium tabular-nums ${value > 0 ? "bg-[#edf4ee] text-[#315c43]" : value < 0 ? "bg-[#fbefec] text-[#9b4434]" : "bg-slate-100 text-slate-600"} ${className}`}>
      <span aria-hidden="true">{value > 0 ? "↗" : value < 0 ? "↘" : "→"}</span>
      {value > 0 ? "+" : value < 0 ? "−" : ""}{formatWeight(Math.abs(value))} kg
      <span className="sr-only">{value > 0 ? " de ganancia" : value < 0 ? " de pérdida" : ", sin cambio"} respecto al pesaje anterior</span>
    </span>
  );
}

export function AnimalWeightSummary({ animal, compact = false }: { animal: { currentWeight: number; latestWeight?: WeightRecord | null; weightChangeKg?: number | null }; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${compact ? "text-sm" : "text-2xl"} font-semibold tabular-nums text-slate-900`}>{formatWeight(animal.latestWeight?.weight ?? animal.currentWeight)} <span className="text-xs font-normal text-slate-500">kg</span></span>
        {animal.latestWeight ? <WeightChange value={animal.latestWeight.deltaKg} /> : <span className="text-xs text-slate-500">Sin historial de pesajes</span>}
      </div>
      <p className="text-xs text-slate-500">{animal.latestWeight ? formatRecordDate(animal.latestWeight.measuredAt) : "Peso de referencia"}</p>
      {!compact && animal.latestWeight?.previousMeasuredAt ? <p className="text-xs text-slate-500">Respecto a {formatWeight(animal.latestWeight.previousWeight!)} kg · {formatRecordDate(animal.latestWeight.previousMeasuredAt)}</p> : null}
    </div>
  );
}

function WeightChart({ records }: { records: WeightRecord[] }) {
  if (records.length < 2) return <div className="rounded-lg border border-[#e1e5e1] bg-[#fafbf9] p-4"><h4 className="text-sm font-semibold text-slate-800">Evolución del peso</h4><p className="mt-4 text-xs leading-relaxed text-slate-500">Se necesitan al menos dos pesajes fechados para mostrar la evolución.</p></div>;
  const chronological = [...records].reverse();
  const values = chronological.map((item) => item.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const first = new Date(chronological[0].measuredAt).getTime();
  const last = new Date(chronological.at(-1)!.measuredAt).getTime();
  const points = chronological.map((item, index) => ({
    x: 24 + (last > first ? (new Date(item.measuredAt).getTime() - first) / (last - first) : index / (chronological.length - 1)) * 552,
    y: 98 - ((item.weight - min) / range) * 68,
    item,
  }));
  return (
    <div className="rounded-lg border border-[#e1e5e1] bg-[#fafbf9] px-4 pb-3 pt-4">
      <div className="flex justify-between text-xs text-slate-500"><span>Evolución del peso</span><span>{formatWeight(min)}–{formatWeight(max)} kg</span></div>
      <svg viewBox="0 0 600 120" className="mt-2 w-full" role="img" aria-label={`Evolución de ${formatWeight(values[0])} a ${formatWeight(values.at(-1)!)} kilos. Los registros detallados aparecen a continuación.`}>
        <path d="M24 105H576 M24 65H576 M24 25H576" fill="none" stroke="#e2e8e2" strokeDasharray="3 5" />
        <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke="#3f7561" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map(({ x, y, item }) => <circle key={item._id} cx={x} cy={y} r="4" fill="#fff" stroke="#3f7561" strokeWidth="2"><title>{formatRecordDate(item.measuredAt)}: {formatWeight(item.weight)} kg</title></circle>)}
      </svg>
      <div className="flex justify-between text-[11px] text-slate-500"><span>{formatRecordDate(chronological[0].measuredAt)}</span><span>{formatRecordDate(chronological.at(-1)!.measuredAt)}</span></div>
    </div>
  );
}

function InitialWeightComparison({ records, initialWeight, currentWeight }: {
  records: WeightRecord[];
  initialWeight?: number;
  currentWeight?: number;
}) {
  const oldest = records.at(-1);
  const latest = records[0];
  const initial = oldest?.weight ?? (initialWeight != null && Number.isFinite(initialWeight) && initialWeight > 0 ? initialWeight : undefined);
  const last = latest?.weight ?? (currentWeight != null && currentWeight > 0 ? currentWeight : undefined);
  if (initial == null || last == null) return <div className="rounded-lg border border-[#e1e5e1] bg-white p-4"><h4 className="text-sm font-semibold text-slate-800">Peso inicial vs. último peso</h4><p className="mt-4 text-xs leading-relaxed text-slate-500">Todavía no hay suficientes datos de peso para comparar.</p></div>;
  const initialDate = oldest?.weight === initial ? oldest.measuredAt : null;
  const difference = Number((last - initial).toFixed(6));
  const percentage = initial > 0 ? difference / initial * 100 : 0;
  const maximum = Math.max(initial, last);
  const changeLabel = difference > 0 ? "Ganancia total" : difference < 0 ? "Pérdida total" : "Sin variación";
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatWeight(Math.abs(value))}`;
  return (
    <div className="rounded-lg border border-[#e1e5e1] bg-white p-4" aria-label="Comparación del peso inicial y el último peso">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Peso inicial vs. último peso</h4>
          <p className="mt-1 text-xs text-slate-500">Cambio total desde el peso inicial del animal.</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold tabular-nums ${difference < 0 ? "text-[#9b4434]" : difference > 0 ? "text-[#315c43]" : "text-slate-600"}`}>{signed(difference)} kg</p>
          <p className="text-xs text-slate-500">{changeLabel} · {signed(percentage)} %</p>
        </div>
      </div>
      <div className="mt-5 space-y-4" role="img" aria-label={`Peso inicial: ${formatWeight(initial)} kilos. Último peso: ${formatWeight(last)} kilos. ${changeLabel}: ${formatWeight(Math.abs(difference))} kilos, ${formatWeight(Math.abs(percentage))} por ciento. Las barras parten de cero.`}>
        {[
          { label: "Inicial", value: initial, date: initialDate, color: "bg-slate-300" },
          { label: "Último", value: last, date: latest?.measuredAt, color: "bg-[#3f7561]" },
        ].map(({ label, value, date, color }) => (
          <div key={label}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs"><span className="font-medium text-slate-600">{label} <span className="ml-1 font-normal text-slate-400">{date ? formatRecordDate(date) : "Fecha no registrada"}</span></span><span className="font-semibold tabular-nums text-slate-800">{formatWeight(value)} kg</span></div>
            <div className="h-3 overflow-hidden rounded bg-[#f0f3ed]" aria-hidden="true"><div className={`h-full rounded ${color}`} style={{ width: `${value / maximum * 100}%` }} /></div>
          </div>
        ))}
      </div>
      {records.length < 2 ? <p className="mt-4 text-xs text-slate-500">{records.length === 1 ? "Solo hay un pesaje fechado. Añade otro vídeo y peso para seguir su evolución." : "Comparación con los pesos guardados del animal; aún no hay pesajes fechados."}</p> : null}
    </div>
  );
}

export default function AnimalWeightHistory({ records = [], videos = [], initialWeight, currentWeight }: { records?: WeightRecord[]; videos?: AnimalHistoryVideo[]; initialWeight?: number; currentWeight?: number }) {
  const sorted = [...records].sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());
  const linkedVideoIds = new Set(sorted.map((record) => record.importId).filter(Boolean));
  const standaloneVideos = videos.filter((video) => !video.importId || !linkedVideoIds.has(video.importId));
  const events = [
    ...sorted.map((record) => ({ id: record._id, date: record.measuredAt, record, video: record.importId ? videos.find((video) => video.importId === record.importId) : undefined })),
    ...standaloneVideos.map((video, index) => ({ id: `video-${video.importId ?? index}`, date: video.measuredAt ?? video.createdAt ?? "", record: undefined, video })),
  ].sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));

  return (
    <section aria-label="Historial de pesos y vídeos" className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-lg border border-[#e1e5e1] bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">Historial del animal</h3><span className="text-xs text-slate-500">Más reciente primero</span></div>
      {!events.length ? <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Todavía no hay pesos ni vídeos registrados.</div> : (
        <ol className="space-y-0">
          {events.map(({ id, date, record, video }, index) => (
            <li key={id} className="relative ml-1 border-l border-[#dce3dc] pb-6 pl-6 last:border-transparent last:pb-0">
              <span className={`absolute -left-[4.5px] top-1 h-2 w-2 rounded-full ${index === 0 ? "bg-[#3f7561]" : "bg-slate-300"}`} aria-hidden="true" />
              <div className="flex flex-wrap items-center justify-between gap-2"><time dateTime={date || undefined} className="text-xs font-medium text-slate-600">{formatRecordDate(date)}</time><span className="text-[11px] text-slate-400">{record && video ? "Pesaje y vídeo" : record ? "Pesaje" : "Vídeo"}</span></div>
              {record ? <>
                <div className="mt-2 flex flex-wrap items-center gap-3"><span className="text-lg font-semibold tabular-nums text-slate-900">{formatWeight(record.weight)} <span className="text-xs font-normal text-slate-500">kg</span></span><WeightChange value={record.deltaKg} /></div>
                {record.previousMeasuredAt ? <p className="mt-1 text-xs leading-relaxed text-slate-500">Anterior: {formatWeight(record.previousWeight!)} kg · {formatRecordDate(record.previousMeasuredAt)}</p> : null}
              </> : <p className="mt-2 text-xs text-slate-500">{video?.weight != null ? `${formatWeight(video.weight)} kg${video.weightInherited ? " · Peso actual del animal. Pendiente de confirmar para este vídeo." : " · Peso del vídeo"}` : "Sin pesaje asociado a este vídeo."}</p>}
              {video ? <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"><video src={video.url} controls preload="none" playsInline className="max-h-64 w-full bg-slate-950" aria-label={`Vídeo del animal del ${formatRecordDate(date)}`} /><p className="truncate px-3 py-2 text-xs text-slate-500">{video.filename || "Vídeo del animal"}{video.createdAt ? ` · Subido el ${formatRecordDate(video.createdAt)}` : ""}</p></div> : null}
            </li>
          ))}
        </ol>
      )}
      </div>
      <aside className="min-w-0 space-y-4" aria-label="Gráficos de peso del animal">
        <WeightChart records={sorted} />
        <InitialWeightComparison records={sorted} initialWeight={initialWeight} currentWeight={currentWeight} />
      </aside>
    </section>
  );
}
