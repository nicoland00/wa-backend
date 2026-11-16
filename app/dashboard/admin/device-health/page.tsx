"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canViewAdminScreens } from "@/lib/permissions";

type SlotStatus = "ok" | "missing" | "future" | "no-device";
type RangeMode = "day" | "week" | "month";

type DeviceHealthDay = { date: string; pingCount: number; expected: number; pct: number };

type DeviceHealthAnimal = {
  id: string;
  earTagNumber: string;
  name: string | null;
  deviceId: string | null;
  ixorigueAnimalId: string | null;
  hasDevice: boolean;
  slots: SlotStatus[] | null;
  days: DeviceHealthDay[];
  overallPingCount: number;
  overallExpected: number;
  overallPct: number;
  lastPingAt: string | null;
  lastKnownAt: string | null;
  battery: number | null;
  deviceSerial: string | null;
  deviceDisabled: boolean | null;
};

type DeviceHealthLot = { id: string; name: string; animals: DeviceHealthAnimal[] };

type HealthData = {
  mode: RangeMode;
  startDate: string;
  endDate: string;
  dates: string[];
  slotMinutes: number;
  ranchId: string;
  ranchName: string;
  lots: DeviceHealthLot[];
  telemetry?: { status: "ok" | "empty"; receivedAnimals: number; positionCount: number };
  warnings?: string[];
};

type Ranch = { _id: string; name: string };

const SLOT_COUNT = 48;
const TZ_OFFSET_MIN = -4 * 60; // ranch local timezone (GMT-4)

function ranchLocalDate(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function slotLabel(index: number): string {
  const h = Math.floor((index * 30) / 60).toString().padStart(2, "0");
  const m = ((index * 30) % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function slotColor(status: SlotStatus): string {
  switch (status) {
    case "ok": return "bg-blue-500";
    case "missing": return "bg-red-400";
    case "future": return "bg-slate-100";
    case "no-device": return "bg-slate-300";
  }
}

function scoreColor(score: number): string {
  if (score >= 76) return "text-emerald-600";
  if (score >= 51) return "text-amber-500";
  if (score >= 26) return "text-orange-500";
  if (score >= 1) return "text-red-500";
  return "text-red-700"; // 0 — no reports
}

// Heatmap cell color for a day's reporting percentage.
// 0% is its own (darkest) bucket; then 1-25, 26-50, 51-75, 76-100.
function dayColor(d: DeviceHealthDay): string {
  if (d.expected === 0) return "bg-slate-100"; // future / no expectation
  if (d.pct >= 76) return "bg-emerald-500";
  if (d.pct >= 51) return "bg-amber-400";
  if (d.pct >= 26) return "bg-orange-400";
  if (d.pct >= 1) return "bg-red-400";
  return "bg-red-700"; // 0% — totally silent
}

function batteryColor(pct: number): string {
  if (pct >= 50) return "text-emerald-600";
  if (pct >= 20) return "text-amber-500";
  return "text-red-500";
}

function formatLastKnown(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: "never", stale: true };
  const then = new Date(iso);
  const local = new Date(then.getTime() + TZ_OFFSET_MIN * 60_000);
  const datePart = local.toISOString().slice(0, 10);
  const h = local.getUTCHours().toString().padStart(2, "0");
  const m = local.getUTCMinutes().toString().padStart(2, "0");
  const diffMin = Math.floor((Date.now() - then.getTime()) / 60_000);
  let rel: string;
  if (diffMin < 60) rel = `${diffMin}m ago`;
  else if (diffMin < 1440) rel = `${Math.floor(diffMin / 60)}h ago`;
  else rel = `${Math.floor(diffMin / 1440)}d ago`;
  return { text: `${datePart} ${h}:${m} · ${rel}`, stale: diffMin > 60 };
}

function TimelineBar({ slots, label }: { slots: SlotStatus[]; label: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="relative">
      <div className="flex h-5 w-full gap-px overflow-hidden rounded-md" aria-label={label}>
        {slots.map((status, i) => (
          <div
            key={i}
            className={`flex-1 cursor-default transition-opacity ${slotColor(status)} ${hovered === i ? "opacity-80" : ""}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </div>
      {hovered !== null && (
        <div className="pointer-events-none absolute -top-8 left-0 z-10 rounded bg-slate-800 px-2 py-1 text-xs text-white shadow-lg" style={{ left: `${(hovered / SLOT_COUNT) * 100}%`, transform: "translateX(-50%)" }}>
          {slotLabel(hovered)} — {slots[hovered]}
        </div>
      )}
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:30</span>
      </div>
    </div>
  );
}

function HeatmapBar({ days }: { days: DeviceHealthDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="relative">
      <div className="flex h-6 w-full gap-px overflow-hidden rounded-md">
        {days.map((d, i) => (
          <div
            key={d.date}
            className={`flex-1 cursor-default transition-opacity ${dayColor(d)} ${hovered === i ? "opacity-80" : ""}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </div>
      {hovered !== null && (
        <div className="pointer-events-none absolute -top-9 z-10 rounded bg-slate-800 px-2 py-1 text-xs text-white shadow-lg" style={{ left: `${((hovered + 0.5) / days.length) * 100}%`, transform: "translateX(-50%)" }}>
          {days[hovered].date.slice(5)} — {days[hovered].expected > 0 ? `${days[hovered].pct}%` : "—"}
        </div>
      )}
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
        <span>{days[0]?.date.slice(5)}</span>
        <span>{days[days.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

export default function DeviceHealthPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canView = session ? canViewAdminScreens(session.user.role) : false;

  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [selectedRanchId, setSelectedRanchId] = useState<string>("");
  const [mode, setMode] = useState<RangeMode>("day");
  const [endDate, setEndDate] = useState<string>(ranchLocalDate(new Date()));
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());

  const [jsonView, setJsonView] = useState<{ text: string; filename: string } | null>(null);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [jsonError, setJsonError] = useState("");
  const jsonRequestRef = useRef(0);

  useEffect(() => {
    jsonRequestRef.current++;
    setJsonView(null); setJsonError(""); setJsonLoading(false);
  }, [selectedRanchId, mode, endDate]);

  async function loadRawJson() {
    if (!selectedRanchId) return;
    const requestId = ++jsonRequestRef.current;
    setJsonLoading(true); setJsonError("");
    try {
      const params = new URLSearchParams({ ranchId: selectedRanchId, range: mode, end: endDate, view: "raw" });
      const response = await fetch(`/api/admin/device-health?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo consultar el JSON de Ixorigue.");
      if (requestId === jsonRequestRef.current) setJsonView({ text: JSON.stringify(payload, null, 2), filename: `ixorigue-${selectedRanchId}-${mode}-${endDate}.json` });
    } catch (cause) {
      if (requestId === jsonRequestRef.current) { setJsonView(null); setJsonError(cause instanceof Error ? cause.message : "No se pudo consultar el JSON."); }
    } finally { if (requestId === jsonRequestRef.current) setJsonLoading(false); }
  }

  function downloadJson() {
    if (!jsonView) return;
    const url = URL.createObjectURL(new Blob([jsonView.text], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = jsonView.filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const today = ranchLocalDate(new Date());
  const span = mode === "month" ? 30 : mode === "week" ? 7 : 1;

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) return;
    fetch("/api/admin/ranches", { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error("No se pudieron cargar las fincas."); return r.json(); })
      .then((d: { ranches: Ranch[] }) => {
        setRanches(d.ranches);
        if (d.ranches.length > 0) setSelectedRanchId(d.ranches[0]._id);
      })
      .catch(() => setError("No se pudieron cargar las fincas. Recarga la página para volver a intentarlo."));
  }, [canView, status]);

  const loadData = useCallback(async (ranchId: string, m: RangeMode, end: string) => {
    if (!ranchId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch(`/api/admin/device-health?ranchId=${ranchId}&range=${m}&end=${end}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "No se pudieron consultar los dispositivos. Vuelve a intentarlo.");
      if (!json || !Array.isArray(json.lots)) throw new Error("La respuesta de dispositivos no es válida.");
      if (requestId !== requestIdRef.current) return;
      setData(json as HealthData);
      setExpandedLots(new Set((json as HealthData).lots.map((l) => l.id)));
    } catch (cause) {
      if (requestId === requestIdRef.current) setError(cause instanceof Error ? cause.message : "No se pudo conectar con el servidor.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRanchId) void loadData(selectedRanchId, mode, endDate);
  }, [selectedRanchId, mode, endDate, loadData]);

  if (status === "loading") return <main className="p-6 text-sm text-slate-600">Cargando…</main>;
  if (!canView) return <main className="p-6 text-sm text-slate-600">No tienes acceso a esta sección.</main>;

  const allAnimals = data?.lots.flatMap((l) => l.animals) ?? [];
  const withDevice = allAnimals.filter((a) => a.hasDevice && a.overallExpected > 0);
  const fleetScore = withDevice.length
    ? Math.round(withDevice.reduce((sum, a) => sum + a.overallPct, 0) / withDevice.length)
    : null;

  const canGoNext = endDate < today;
  const startDate = addDays(endDate, -(span - 1));
  const periodLabel =
    mode === "day"
      ? endDate === today ? "Today" : endDate === addDays(today, -1) ? "Yesterday" : endDate
      : `${startDate.slice(5)} – ${endDate.slice(5)}`;

  return (
    <main className="min-h-screen bg-[#f6f7f4] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dispositivos</h1>
          <p className="text-sm text-slate-500">Reporting timeline per device — real GPS history from Ixorigue (expected every 30 min).</p>
        </div>

        {/* Controls — stack on mobile, never overflow */}
        <div className="space-y-2">
          <select
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-none sm:w-auto"
            value={selectedRanchId}
            onChange={(e) => setSelectedRanchId(e.target.value)}
          >
            {ranches.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-2">
            {/* Range mode */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              {(["day", "week", "month"] as RangeMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setEndDate(today); }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                    mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:text-blue-600"
                  }`}
                >
                  {m === "day" ? "Day" : m === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>

            {/* Period navigation */}
            <div className="inline-flex items-center gap-1">
              <button
                onClick={() => setEndDate(addDays(endDate, -span))}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600"
                aria-label="Previous period"
              >
                ←
              </button>
              <span className="min-w-[7rem] text-center text-xs font-medium text-slate-700">{periodLabel}</span>
              <button
                onClick={() => canGoNext && setEndDate(addDays(endDate, span))}
                disabled={!canGoNext}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40"
                aria-label="Next period"
              >
                →
              </button>
            </div>
          </div>
        </div>

        {session?.user.role === "admin" ? <div className="space-y-3">
          <button type="button" disabled={!selectedRanchId || jsonLoading} onClick={() => void loadRawJson()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">{jsonLoading ? "Consultando JSON…" : jsonView ? "Actualizar JSON de Ixorigue" : "Ver JSON de Ixorigue"}</button>
          {jsonError ? <p role="alert" className="text-sm text-red-700">{jsonError}</p> : null}
          {jsonView ? <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Respuesta JSON original de Ixorigue">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              <div><h2 className="text-sm font-semibold text-slate-800">JSON original de Ixorigue</h2><p className="mt-1 text-xs text-slate-500">Respuesta sin procesar del periodo seleccionado y fechas enviadas en UTC.</p></div>
              <div className="flex gap-3"><button type="button" onClick={downloadJson} className="text-xs font-medium text-[#31574b] underline">Descargar JSON</button><button type="button" onClick={() => setJsonView(null)} className="text-xs text-slate-500">Cerrar</button></div>
            </div>
            <pre tabIndex={0} className="max-h-80 overflow-auto bg-slate-950 p-4 text-[11px] leading-relaxed text-slate-200">{jsonView.text}</pre>
          </section> : null}
        </div> : null}

        {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{error}</p>
          {selectedRanchId ? <button type="button" disabled={loading} onClick={() => void loadData(selectedRanchId, mode, endDate)} className="font-medium underline disabled:opacity-50">Reintentar</button> : null}
        </div> : null}
        {data?.telemetry?.status === "empty" && !loading ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">La consulta a Ixorigue se completó, pero no se encontraron posiciones válidas al procesar el periodo seleccionado. Prueba un día anterior o el rango semanal.{session?.user.role === "admin" ? " Puedes comprobar la respuesta original con «Ver JSON de Ixorigue»." : ""}</p> : null}
        {!loading ? data?.warnings?.map((warning) => <p key={warning} role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{warning}</p>) : null}

        {/* Fleet summary */}
        {data && !loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[#e1e5e1] bg-white p-4 shadow-none">
              <p className="text-xs text-slate-500">Fleet health</p>
              <p className={`mt-1 text-2xl font-bold ${fleetScore !== null ? scoreColor(fleetScore) : "text-slate-400"}`}>
                {fleetScore !== null ? `${fleetScore}%` : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-[#e1e5e1] bg-white p-4 shadow-none">
              <p className="text-xs text-slate-500">Devices tracked</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{withDevice.length}</p>
            </div>
            <div className="rounded-lg border border-[#e1e5e1] bg-white p-4 shadow-none">
              <p className="text-xs text-slate-500">Reporting well (≥75%)</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{withDevice.filter((a) => a.overallPct >= 75).length}</p>
            </div>
            <div className="rounded-lg border border-[#e1e5e1] bg-white p-4 shadow-none">
              <p className="text-xs text-slate-500">Critical (&lt;25%)</p>
              <p className="mt-1 text-2xl font-bold text-red-500">{withDevice.filter((a) => a.overallPct < 25).length}</p>
            </div>
          </div>
        )}

        {/* Legend */}
        {mode === "day" ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-blue-500" /> Ping received</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-red-400" /> Gap (missed)</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-slate-100 border border-slate-200" /> Future</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-slate-300" /> No device</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-emerald-500" /> 76–100%</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-amber-400" /> 51–75%</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-orange-400" /> 26–50%</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-red-400" /> 1–25%</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-red-700" /> 0%</span>
          </div>
        )}

        {loading && <div className="py-12 text-center text-sm text-slate-400">Loading device data…</div>}

        {!loading && data && data.lots.map((lot) => {
          const withDev = lot.animals.filter((a) => a.hasDevice && a.overallExpected > 0);
          const ok = withDev.filter((a) => a.overallPct >= 75).length;
          // Lot health = average reporting % of its devices (not the share reporting well).
          const lotPct = withDev.length
            ? Math.round(withDev.reduce((s, a) => s + a.overallPct, 0) / withDev.length)
            : 0;
          const isExpanded = expandedLots.has(lot.id);

          return (
            <section key={lot.id} className="rounded-lg border border-[#e1e5e1] bg-white shadow-none overflow-hidden">
              <button
                className="flex w-full items-center justify-between gap-2 px-4 py-4 text-left hover:bg-slate-50 transition sm:px-5"
                onClick={() => {
                  setExpandedLots((prev) => {
                    const next = new Set(prev);
                    if (next.has(lot.id)) next.delete(lot.id); else next.add(lot.id);
                    return next;
                  });
                }}
              >
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900 truncate">{lot.name}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {withDev.length > 0 ? `${ok}/${withDev.length} reporting well` : "No devices assigned"} · {lot.animals.length} animals
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {withDev.length > 0 && <span className={`text-sm font-bold ${scoreColor(lotPct)}`}>{lotPct}%</span>}
                  <span className="text-slate-400">{isExpanded ? "▲" : "▼"}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="divide-y divide-slate-50 border-t border-slate-100">
                  {lot.animals.map((animal) => {
                    const lastSeen = formatLastKnown(animal.lastKnownAt);
                    return (
                      <div key={animal.id} className="px-4 py-4 sm:px-5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-sm text-slate-800 truncate">
                              #{animal.earTagNumber}{animal.name ? ` · ${animal.name}` : ""}
                            </span>
                            {(animal.deviceSerial || animal.deviceId) && (
                              <span className="hidden sm:inline rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 font-mono truncate">
                                {animal.deviceSerial ?? animal.deviceId}
                              </span>
                            )}
                            {animal.deviceDisabled && (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">disabled</span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500 sm:gap-3">
                            {animal.battery !== null && (
                              <span className={`font-medium ${batteryColor(Math.round(animal.battery * 100))}`}>
                                🔋 {Math.round(animal.battery * 100)}%
                              </span>
                            )}
                            <span className={`font-bold ${scoreColor(animal.overallPct)}`}>
                              {animal.hasDevice && animal.overallExpected > 0 ? `${animal.overallPct}%` : "—"}
                            </span>
                          </div>
                        </div>

                        {!animal.hasDevice ? (
                          <div className="rounded-md bg-slate-100 px-3 py-2 text-[11px] text-slate-400">No device assigned</div>
                        ) : mode === "day" && animal.slots ? (
                          <TimelineBar slots={animal.slots} label={`Animal ${animal.earTagNumber} timeline`} />
                        ) : (
                          <HeatmapBar days={animal.days} />
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
                          <span className="text-slate-400">Last known fix:</span>
                          <span className={lastSeen.stale ? "font-medium text-red-500" : "font-medium text-emerald-600"}>{lastSeen.text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {!loading && data && data.lots.length === 0 && (
          <div className="rounded-lg border border-[#e1e5e1] bg-white p-12 text-center text-sm text-slate-400 shadow-none">
            No animals found for this ranch.
          </div>
        )}
      </div>
    </main>
  );
}
