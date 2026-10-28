"use client";

import { useState } from "react";

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

export default function AnimalWeightDetails({ records = [], videos = [], initialWeight, currentWeight }: {
  records?: WeightRecord[];
  videos?: AnimalHistoryVideo[];
  initialWeight?: number;
  currentWeight?: number;
}) {
  const sorted = [...records].sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());
  const first = sorted.at(-1);
  const latest = sorted[0];
  const initial = first?.weight ?? (initialWeight != null && initialWeight > 0 ? initialWeight : null);
  const last = latest?.weight ?? (currentWeight != null && currentWeight > 0 ? currentWeight : null);
  const difference = initial != null && last != null ? Number((last - initial).toFixed(6)) : null;
  const [selectedVideoUrl, setSelectedVideoUrl] = useState("");
  const video = videos.find((item) => item.url === selectedVideoUrl) ?? videos[0];
  const changeLabel = difference == null ? "Variación total" : difference > 0 ? "Ganancia total" : difference < 0 ? "Pérdida total" : "Sin variación";
  const singleMeasurement = sorted.length === 1 && initial === last;

  return (
    <div className="space-y-5">
      <section aria-label="Peso inicial y peso final" className="overflow-hidden rounded-lg border border-[#e1e5e1]">
        <dl className="grid grid-cols-2 divide-x divide-[#e1e5e1] bg-white">
          {[
            { label: "Peso inicial", weight: initial, date: first?.measuredAt },
            { label: "Peso final", weight: last, date: latest?.measuredAt },
          ].map(({ label, weight, date }) => (
            <div key={label} className="px-4 py-5 sm:px-5">
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-900">
                {weight != null ? formatWeight(weight) : "—"}<span className="ml-1 text-sm font-normal text-slate-400">kg</span>
              </dd>
              <dd className="mt-1.5 text-[11px] text-slate-400">{date ? formatRecordDate(date) : "Sin fecha registrada"}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between gap-3 border-t border-[#e1e5e1] bg-[#f7f9f5] px-4 py-3 sm:px-5">
          <span className="text-xs text-slate-500">{singleMeasurement ? "Un único pesaje registrado" : changeLabel}</span>
          {!singleMeasurement && difference != null ? <span className={`text-sm font-semibold tabular-nums ${difference > 0 ? "text-[#315c43]" : difference < 0 ? "text-[#9b4434]" : "text-slate-600"}`}>
            {difference > 0 ? "+" : difference < 0 ? "−" : ""}{formatWeight(Math.abs(difference))} kg
          </span> : null}
        </div>
      </section>

      {video ? <section aria-label="Vídeos del animal" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-slate-600">{videos.length > 1 ? "Vídeos del animal" : "Vídeo del animal"}</h3>
          {videos.length > 1 ? <label className="min-w-0 max-w-full">
            <span className="sr-only">Seleccionar vídeo del animal</span>
            <select value={video.url} onChange={(event) => setSelectedVideoUrl(event.target.value)} className="max-w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
              {videos.map((item, index) => <option key={item.importId ?? item.url} value={item.url}>Vídeo {videos.length - index} · {formatRecordDate(item.measuredAt ?? item.createdAt)}</option>)}
            </select>
          </label> : null}
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          <video key={video.url} src={video.url} controls preload="metadata" playsInline className="max-h-64 w-full" aria-label="Vídeo del animal" />
        </div>
        <p className="text-[11px] text-slate-400">{video.measuredAt || video.createdAt ? formatRecordDate(video.measuredAt ?? video.createdAt) : "Fecha no registrada"}{video.weight != null ? ` · ${formatWeight(video.weight)} kg${video.weightInherited ? " (peso de referencia)" : ""}` : ""}</p>
      </section> : null}
    </div>
  );
}
