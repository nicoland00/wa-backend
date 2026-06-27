"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
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
  if (score >= 75) return "text-emerald-600";
  if (score >= 50) return "text-amber-500";
  if (score >= 25) return "text-orange-500";
  return "text-red-500";
}

// Heatmap cell color for a day's reporting percentage (quartiles).
function dayColor(d: DeviceHealthDay): string {
  if (d.expected === 0) return "bg-slate-100"; // future / no expectation
  if (d.pct >= 75) return "bg-emerald-500";
  if (d.pct >= 50) return "bg-amber-400";
  if (d.pct >= 25) return "bg-orange-400";
  return "bg-red-400";
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
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());

  const today = ranchLocalDate(new Date());
  const span = mode === "month" ? 30 : mode === "week" ? 7 : 1;

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) return;
    fetch("/api/admin/ranches", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ranches: Ranch[] }) => {
        setRanches(d.ranches);
        if (d.ranches.length > 0) setSelectedRanchId(d.ranches[0]._id);
      })
      .catch(() => null);
  }, [canView, status]);

  const loadData = useCallback(async (ranchId: string, m: RangeMode, end: string) => {
    if (!ranchId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/device-health?ranchId=${ranchId}&range=${m}&end=${end}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as HealthData;
        setData(json);
        setExpandedLots(new Set(json.lots.map((l) => l.id)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRanchId) void loadData(selectedRanchId, mode, endDate);
  }, [selectedRanchId, mode, endDate, loadData]);

  if (status === "loading") return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  if (!canView) return <main className="p-6 text-sm text-slate-600">Forbidden</main>;

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
    <main className="min-h-screen bg-[#f7f9fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">← Dashboard</Link>

        <div>
          <h1 className="text-xl font-bold text-slate-900">Device Health</h1>
          <p className="text-sm text-slate-500">Reporting timeline per device — real GPS history from Ixorigue (expected every 30 min).</p>
        </div>

        {/* Controls — stack on mobile, never overflow */}
        <div className="space-y-2">
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm sm:w-auto"
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

        {/* Fleet summary */}
        {data && !loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Fleet health</p>
              <p className={`mt-1 text-2xl font-bold ${fleetScore !== null ? scoreColor(fleetScore) : "text-slate-400"}`}>
                {fleetScore !== null ? `${fleetScore}%` : "—"}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Devices tracked</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{withDevice.length}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Reporting well (≥75%)</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{withDevice.filter((a) => a.overallPct >= 75).length}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
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
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-emerald-500" /> 75–100%</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-amber-400" /> 50–75%</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-orange-400" /> 25–50%</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm bg-red-400" /> 0–25%</span>
          </div>
        )}

        {loading && <div className="py-12 text-center text-sm text-slate-400">Loading device data…</div>}

        {!loading && data && data.lots.map((lot) => {
          const withDev = lot.animals.filter((a) => a.hasDevice && a.overallExpected > 0);
          const ok = withDev.filter((a) => a.overallPct >= 75).length;
          const lotPct = withDev.length ? Math.round((ok / withDev.length) * 100) : 0;
          const isExpanded = expandedLots.has(lot.id);

          return (
            <section key={lot.id} className="rounded-2xl bg-white shadow-sm overflow-hidden">
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
          <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-400 shadow-sm">
            No animals found for this ranch.
          </div>
        )}
      </div>
    </main>
  );
}
