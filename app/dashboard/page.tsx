"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import MapView from "@/components/MapView";
import { canViewAdminScreens } from "@/lib/permissions";
import type { Lot as MapLot } from "@/lib/api";

type Ranch = {
  _id: string;
  name: string;
  ixorigueRanchId: string | null;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string | null;
};

type Lot = {
  _id: string;
  ranchId: string;
  name: string;
  ixorigueLotId: string | null;
  geometry: { type: "Polygon"; coordinates: number[][][] } | null;
  animalCount?: number;
};

type Animal = {
  _id: string;
  lotId: string;
  name?: string | null;
  specie?: string | null;
  sex: string;
  breed: string;
  color: string;
  brandNumber: string;
  earTagNumber: string;
  initialWeight?: number;
  currentWeight: number;
  lifeStatus: "alive" | "dead";
  registerReason?: string | null;
  birthDate?: string | null;
  dateOfPurchase?: string | null;
  syncStatus?: "pending" | "synced" | "failed";
  syncError?: string | null;
  ixorigueAnimalId: string | null;
  photoUrl: string | null;
  videoUrl: string | null;
  coordinates?: { lat: number; lng: number } | null;
};

type ImportItem = {
  _id: string;
  ranchId: string;
  lotId: string | null;
  animalId: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes?: number | null;
  status: string;
  createdAt: string;
  videoUrl?: string | null;
};

type MapResponse = {
  ranch: Ranch;
  lots: Lot[];
  animals: Animal[];
  importsByLot: ImportItem[];
};

const DASHBOARD_SELECTED_RANCH_KEY = "pastora.dashboard.selectedRanchId";
const DASHBOARD_SELECTED_LOT_KEY_PREFIX = "pastora.dashboard.selectedLotId";

function readStoredSelectedRanchId() {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(DASHBOARD_SELECTED_RANCH_KEY) ?? ""; } catch { return ""; }
}

function writeStoredSelectedRanchId(ranchId: string) {
  if (typeof window === "undefined") return;
  try {
    if (ranchId) window.localStorage.setItem(DASHBOARD_SELECTED_RANCH_KEY, ranchId);
    else window.localStorage.removeItem(DASHBOARD_SELECTED_RANCH_KEY);
  } catch {}
}

function getSelectedLotStorageKey(ranchId: string) {
  return `${DASHBOARD_SELECTED_LOT_KEY_PREFIX}:${ranchId}`;
}

function readStoredSelectedLotId(ranchId: string) {
  if (typeof window === "undefined" || !ranchId) return "";
  try { return window.localStorage.getItem(getSelectedLotStorageKey(ranchId)) ?? ""; } catch { return ""; }
}

function writeStoredSelectedLotId(ranchId: string, lotId: string) {
  if (typeof window === "undefined" || !ranchId) return;
  try {
    if (lotId) window.localStorage.setItem(getSelectedLotStorageKey(ranchId), lotId);
    else window.localStorage.removeItem(getSelectedLotStorageKey(ranchId));
  } catch {}
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatSize(value: number | null | undefined) {
  if (!value) return "Unknown";
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function SyncStatusBadge({ status }: { status: string }) {
  const color = status === "synced"
    ? "bg-[#d1ede5] text-[#2d7a5e]"
    : status === "failed"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${color}`}>
      {status}
    </span>
  );
}

function VideoThumbnail({ videoUrl, filename }: { videoUrl: string; filename: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <>
      <div className="relative mt-3 overflow-hidden rounded-xl bg-slate-900">
        <video
          src={videoUrl}
          className="h-32 w-full object-cover opacity-80"
          preload="metadata"
          muted
          playsInline
        />
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/40"
          aria-label="Open video"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#57A28B]">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      </div>
      {modalOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative w-full max-w-2xl rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
            >
              ✕
            </button>
            <p className="truncate px-5 pt-4 text-sm font-medium text-white/70">{filename}</p>
            <video
              src={videoUrl}
              controls
              autoPlay
              className="mt-2 w-full rounded-b-2xl"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [selectedRanchId, setSelectedRanchId] = useState("");
  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [activeAnimalId, setActiveAnimalId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const selectedLotIdRef = useRef(selectedLotId);

  const hasAdminAccess = session ? canViewAdminScreens(session.user.role) : false;

  function handleSelectRanch(ranchId: string) {
    setSelectedRanchId(ranchId);
    setSelectedLotId("");
    setActiveAnimalId(null);
  }

  function handleSelectLot(lotId: string) {
    setSelectedLotId(lotId);
    setActiveAnimalId(null);
    writeStoredSelectedLotId(selectedRanchId, lotId);
  }

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  useEffect(() => {
    selectedLotIdRef.current = selectedLotId;
  }, [selectedLotId]);

  useEffect(() => {
    if (status !== "authenticated") return;

    async function loadRanches() {
      const url = hasAdminAccess ? "/api/admin/ranches" : "/api/my/ranches";
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { ranches: Ranch[] };
      setRanches(data.ranches);
      setSelectedRanchId((current) => {
        if (current && data.ranches.some((r) => r._id === current)) return current;
        const stored = readStoredSelectedRanchId();
        return data.ranches.some((r) => r._id === stored) ? stored : data.ranches[0]?._id || "";
      });
    }

    void loadRanches();
  }, [hasAdminAccess, status]);

  async function loadRanchMap(ranchId: string) {
    if (!ranchId) {
      setLots([]); setAnimals([]); setImports([]); setSelectedLotId(""); setActiveAnimalId(null);
      return;
    }
    const response = await fetch(`/api/map/ranch/${ranchId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as MapResponse;
    const storedLotId = readStoredSelectedLotId(ranchId);
    const nextLotId = data.lots.some((lot) => lot._id === selectedLotIdRef.current)
      ? selectedLotIdRef.current
      : data.lots.some((lot) => lot._id === storedLotId)
        ? storedLotId
        : "";
    setLots(data.lots);
    setSelectedLotId(nextLotId);
    writeStoredSelectedLotId(ranchId, nextLotId);
    setAnimals(data.animals);
    setImports(data.importsByLot);
  }

  useEffect(() => {
    void loadRanchMap(selectedRanchId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRanchId]);

  useEffect(() => {
    writeStoredSelectedRanchId(selectedRanchId);
  }, [selectedRanchId]);

  async function triggerSync() {
    if (!selectedRanchId || !hasAdminAccess) return;
    setSyncing(true);
    try {
      await fetch(`/api/admin/ranches/${selectedRanchId}/sync-remote`, { method: "POST" });
      await loadRanchMap(selectedRanchId);
    } finally {
      setSyncing(false);
    }
  }

  // Auto-sync on ranch load — runs after initial data is loaded so map refreshes with fresh animals
  useEffect(() => {
    const ranch = ranches.find((r) => r._id === selectedRanchId);
    if (!ranch?.ixorigueRanchId || !hasAdminAccess || !selectedRanchId) return;
    void triggerSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRanchId]);  // intentionally omit hasAdminAccess — stable after login

  const selectedRanch = ranches.find((r) => r._id === selectedRanchId) ?? null;
  const selectedLot = lots.find((lot) => lot._id === selectedLotId) ?? null;
  const visibleAnimals = selectedLotId ? animals.filter((a) => a.lotId === selectedLotId) : animals;
  const visibleImports = selectedLotId ? imports.filter((i) => i.lotId === selectedLotId) : imports;

  const lotById = useMemo(() => new Map(lots.map((lot) => [lot._id, lot])), [lots]);
  const animalById = useMemo(() => new Map(animals.map((a) => [a._id, a])), [animals]);
  const activeAnimal = useMemo(() => animals.find((a) => a._id === activeAnimalId) ?? null, [activeAnimalId, animals]);

  const sortedVisibleAnimals = useMemo(() => {
    return [...visibleAnimals].sort((l, r) => {
      const ln = lotById.get(l.lotId)?.name ?? "";
      const rn = lotById.get(r.lotId)?.name ?? "";
      if (!selectedLotId && ln !== rn) return ln.localeCompare(rn);
      return (l.earTagNumber || "").localeCompare(r.earTagNumber || "");
    });
  }, [lotById, selectedLotId, visibleAnimals]);

  const activeAnimalImports = useMemo(() => {
    if (!activeAnimal) return { items: [] as ImportItem[], mode: "none" as "none" | "direct" | "lot" };
    const tokens = [activeAnimal.earTagNumber, activeAnimal.brandNumber, activeAnimal.name, activeAnimal.ixorigueAnimalId]
      .map(normalizeSearchValue).filter(Boolean);
    const direct = imports.filter((item) => {
      if (item.animalId === activeAnimal._id) return true;
      const hay = normalizeSearchValue([item.filename, item.mimeType, item.status].filter(Boolean).join(" "));
      return tokens.some((t) => hay.includes(t));
    });
    if (direct.length) return { items: direct, mode: "direct" as const };
    const lot = imports.filter((item) => item.lotId === activeAnimal.lotId);
    if (lot.length) return { items: lot, mode: "lot" as const };
    return { items: [] as ImportItem[], mode: "none" as const };
  }, [activeAnimal, imports]);

  const mapLots = useMemo<MapLot[]>(
    () => lots.filter((lot) => lot.geometry).map((lot) => ({
      lotId: lot._id,
      farmId: lot.ranchId,
      name: lot.name,
      ixorigueId: lot.ixorigueLotId ?? lot._id,
      geometry: lot.geometry as { type: "Polygon"; coordinates: number[][][] },
    })),
    [lots],
  );

  const mapAnimals = useMemo(
    () => animals
      .filter((a) => a.coordinates?.lat != null && a.coordinates?.lng != null)
      .map((a) => ({
        animalId: a._id,
        lotId: a.lotId,
        earTagNumber: a.earTagNumber,
        lotName: lotById.get(a.lotId)?.name ?? "Unknown lot",
        breed: a.breed,
        sex: a.sex,
        currentWeight: a.currentWeight,
        coordinates: { lat: a.coordinates!.lat, lng: a.coordinates!.lng },
      })),
    [animals, lotById],
  );

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7f5]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#57A28B] border-t-transparent" />
          <p className="text-sm font-medium text-slate-500">Loading session...</p>
        </div>
      </main>
    );
  }

  if (!session) return null;

  return (
    <main className="min-h-screen bg-[#f4f7f5] p-4 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">

        {/* Header */}
        <header className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#57A28B]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="h-5 w-5">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-slate-900">Pastora Dashboard</h1>
                  <p className="text-xs text-slate-500">{session.user.email} · {session.user.role}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/profile" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]">Profile</Link>
              {hasAdminAccess ? (
                <>
                  <Link href="/dashboard/admin/users" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]">Users</Link>
                  <Link href="/dashboard/admin/ranches" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]">Ranches</Link>
                  <Link href="/dashboard/admin/lots" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]">Lots</Link>
                  <Link href="/dashboard/admin/animals" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]">Animals</Link>
                  <Link href="/dashboard/admin/imports" className="rounded-xl border border-[#57A28B]/30 bg-[#d1ede5]/60 px-3 py-2 text-sm font-medium text-[#2d7a5e] transition hover:bg-[#d1ede5]">Videos</Link>
                  <Link href="/dashboard/admin/sync-jobs" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]">Sync Jobs</Link>
                  <Link href="/dashboard/admin/ixorigue" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]">Ixorigue</Link>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => void signOut({ callbackUrl: "/login" })}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:max-w-[560px]">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Ranch</span>
                <select
                  value={selectedRanchId}
                  onChange={(e) => handleSelectRanch(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition focus:border-[#57A28B] focus:outline-none focus:ring-2 focus:ring-[#57A28B]/20"
                >
                  {ranches.map((r) => (
                    <option key={r._id} value={r._id}>{r.name}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-slate-700">Lot</span>
                <select
                  value={selectedLotId}
                  onChange={(e) => handleSelectLot(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition focus:border-[#57A28B] focus:outline-none focus:ring-2 focus:ring-[#57A28B]/20"
                >
                  <option value="">All lots</option>
                  {lots.map((lot) => (
                    <option key={lot._id} value={lot._id}>{lot.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
              <div className="grid flex-1 gap-x-6 gap-y-2 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ranch</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-800">{selectedRanch?.name ?? "None"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lot</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-800">{selectedLot?.name ?? "All lots"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Animals</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-800">{visibleAnimals.length}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sync</p>
                  <div className="mt-0.5">
                    {selectedRanch ? <SyncStatusBadge status={selectedRanch.syncStatus} /> : <span className="text-sm text-slate-400">—</span>}
                  </div>
                </div>
              </div>
              {hasAdminAccess && selectedRanchId ? (
                <button
                  type="button"
                  onClick={() => void triggerSync()}
                  disabled={syncing}
                  className="flex items-center gap-1.5 rounded-xl border border-[#57A28B]/30 bg-[#d1ede5]/60 px-3 py-2 text-xs font-semibold text-[#2d7a5e] transition hover:bg-[#d1ede5] disabled:opacity-60"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}>
                    <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {/* Map */}
        <MapView lots={mapLots} animals={mapAnimals} selectedLotId={selectedLotId || null} onSelectLot={handleSelectLot} />

        {/* Unified Animals section */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                {selectedLot ? selectedLot.name : "Animals"}
              </h2>
              <span className="rounded-full bg-[#d1ede5] px-3 py-1 text-xs font-semibold text-[#2d7a5e]">
                {sortedVisibleAnimals.length}
              </span>
              {selectedLot ? (
                <button type="button" onClick={() => handleSelectLot("")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50">
                  Clear lot
                </button>
              ) : null}
            </div>
            {/* Grid / List toggle */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${viewMode === "grid" ? "bg-[#57A28B] text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${viewMode === "list" ? "bg-[#57A28B] text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z"/></svg>
                List
              </button>
            </div>
          </div>

          {sortedVisibleAnimals.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-12 text-center">
              <p className="text-sm font-medium text-slate-400">{selectedLotId ? "No animals in this lot." : "No animals yet — sync will populate them."}</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedVisibleAnimals.map((animal) => {
                const videoUrl = animal.videoUrl ?? imports.find((i) => i.animalId === animal._id)?.videoUrl ?? null;
                return (
                  <article
                    key={animal._id}
                    className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60 transition hover:border-[#57A28B]/40 hover:shadow-md cursor-pointer"
                    onClick={() => setActiveAnimalId(animal._id)}
                  >
                    {/* Video / placeholder thumbnail */}
                    <div className="relative bg-slate-200" style={{ aspectRatio: "16/9" }}>
                      {videoUrl ? (
                        <>
                          <video src={videoUrl} className="h-full w-full object-cover" preload="metadata" muted playsInline />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow">
                              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-[#57A28B]"><path d="M8 5v14l11-7z"/></svg>
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-slate-300">
                            <path d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    {/* Animal info */}
                    <div className="p-3.5">
                      <p className="text-sm font-semibold text-slate-900">{animal.earTagNumber}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{animal.breed || "—"} · {animal.sex || "—"}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">{animal.currentWeight} kg</span>
                        {!selectedLotId ? <span className="text-xs text-slate-400">{lotById.get(animal.lotId)?.name ?? "—"}</span> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="pb-2 pr-4">Ear tag</th>
                    <th className="pb-2 pr-4">Breed</th>
                    <th className="pb-2 pr-4">Sex</th>
                    <th className="pb-2 pr-4">Weight</th>
                    {!selectedLotId ? <th className="pb-2 pr-4">Lot</th> : null}
                    <th className="pb-2 pr-4">Video</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sortedVisibleAnimals.map((animal) => {
                    const hasVideo = !!(animal.videoUrl ?? imports.find((i) => i.animalId === animal._id)?.videoUrl);
                    return (
                      <tr key={animal._id} className="text-slate-700 hover:bg-slate-50/60">
                        <td className="py-2.5 pr-4 font-semibold text-slate-900">{animal.earTagNumber}</td>
                        <td className="py-2.5 pr-4">{animal.breed || "—"}</td>
                        <td className="py-2.5 pr-4">{animal.sex || "—"}</td>
                        <td className="py-2.5 pr-4">{animal.currentWeight} kg</td>
                        {!selectedLotId ? <td className="py-2.5 pr-4 text-slate-500">{lotById.get(animal.lotId)?.name ?? "—"}</td> : null}
                        <td className="py-2.5 pr-4">
                          {hasVideo ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#d1ede5] px-2.5 py-0.5 text-[11px] font-semibold text-[#2d7a5e]">
                              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M8 5v14l11-7z"/></svg>
                              Video
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <button
                            type="button"
                            onClick={() => setActiveAnimalId(animal._id)}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-[#57A28B]/40 hover:bg-[#d1ede5]/40 hover:text-[#57A28B]"
                          >
                            Info
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Animal detail modal */}
      {activeAnimal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
          onClick={() => setActiveAnimalId(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#57A28B]">Animal</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">{activeAnimal.earTagNumber}</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {activeAnimal.name ?? activeAnimal.breed ?? "—"} · {lotById.get(activeAnimal.lotId)?.name ?? "Unknown lot"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAnimalId(null)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
              <section className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Details</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Lot", lotById.get(activeAnimal.lotId)?.name ?? "—"],
                    ["Species", activeAnimal.specie ?? "—"],
                    ["Breed", activeAnimal.breed || "—"],
                    ["Sex", activeAnimal.sex || "—"],
                    ["Color", activeAnimal.color || "—"],
                    ["Brand", activeAnimal.brandNumber || "—"],
                    ["Current weight", `${activeAnimal.currentWeight} kg`],
                    ["Initial weight", activeAnimal.initialWeight != null ? `${activeAnimal.initialWeight} kg` : "—"],
                    ["Life status", activeAnimal.lifeStatus],
                    ["Ixorigue ID", activeAnimal.ixorigueAnimalId ?? "Local only"],
                    ["Birth date", formatDateTime(activeAnimal.birthDate)],
                    ["Purchase date", formatDateTime(activeAnimal.dateOfPurchase)],
                    ["Register reason", activeAnimal.registerReason ?? "—"],
                    ["Sync", activeAnimal.syncStatus ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
                      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
                    </div>
                  ))}
                </div>
                {activeAnimal.syncError ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Sync error: {activeAnimal.syncError}
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-100 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Video</h3>
                {activeAnimal.videoUrl ? (
                  <div className="mt-3">
                    <VideoThumbnail videoUrl={activeAnimal.videoUrl} filename="" />
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-400">
                    No video assigned to this animal yet.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
