"use client";

import Script from "next/script";
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
  filename: string;
  mimeType: string | null;
  sizeBytes?: number | null;
  status: string;
  createdAt: string;
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
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(DASHBOARD_SELECTED_RANCH_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredSelectedRanchId(ranchId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (ranchId) {
      window.localStorage.setItem(DASHBOARD_SELECTED_RANCH_KEY, ranchId);
      return;
    }

    window.localStorage.removeItem(DASHBOARD_SELECTED_RANCH_KEY);
  } catch {}
}

function getSelectedLotStorageKey(ranchId: string) {
  return `${DASHBOARD_SELECTED_LOT_KEY_PREFIX}:${ranchId}`;
}

function readStoredSelectedLotId(ranchId: string) {
  if (typeof window === "undefined" || !ranchId) {
    return "";
  }

  try {
    return window.localStorage.getItem(getSelectedLotStorageKey(ranchId)) ?? "";
  } catch {
    return "";
  }
}

function writeStoredSelectedLotId(ranchId: string, lotId: string) {
  if (typeof window === "undefined" || !ranchId) {
    return;
  }

  try {
    if (lotId) {
      window.localStorage.setItem(getSelectedLotStorageKey(ranchId), lotId);
      return;
    }

    window.localStorage.removeItem(getSelectedLotStorageKey(ranchId));
  } catch {}
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatSize(value: number | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  return `${(value / 1024 / 1024).toFixed(2)} MB`;
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
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    selectedLotIdRef.current = selectedLotId;
  }, [selectedLotId]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    async function loadRanches() {
      const response = await fetch("/api/admin/ranches", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { ranches: Ranch[] };
      setRanches(data.ranches);
      setSelectedRanchId((current) => {
        if (current && data.ranches.some((ranch) => ranch._id === current)) {
          return current;
        }

        const storedRanchId = readStoredSelectedRanchId();
        return data.ranches.some((ranch) => ranch._id === storedRanchId) ? storedRanchId : data.ranches[0]?._id || "";
      });
    }

    async function loadUserRanches() {
      const response = await fetch("/api/my/ranches", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { ranches: Ranch[] };
      setRanches(data.ranches);
      setSelectedRanchId((current) => {
        if (current && data.ranches.some((ranch) => ranch._id === current)) {
          return current;
        }

        const storedRanchId = readStoredSelectedRanchId();
        return data.ranches.some((ranch) => ranch._id === storedRanchId) ? storedRanchId : data.ranches[0]?._id || "";
      });
    }

    void (hasAdminAccess ? loadRanches() : loadUserRanches());
  }, [hasAdminAccess, status]);

  useEffect(() => {
    async function loadRanchMap() {
      if (!selectedRanchId) {
        setLots([]);
        setAnimals([]);
        setImports([]);
        setSelectedLotId("");
        setActiveAnimalId(null);
        return;
      }

      const response = await fetch(`/api/map/ranch/${selectedRanchId}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as MapResponse;
      const storedLotId = readStoredSelectedLotId(selectedRanchId);
      const nextLotId = data.lots.some((lot) => lot._id === selectedLotIdRef.current)
        ? selectedLotIdRef.current
        : data.lots.some((lot) => lot._id === storedLotId)
          ? storedLotId
          : "";

      setLots(data.lots);
      setSelectedLotId(nextLotId);
      writeStoredSelectedLotId(selectedRanchId, nextLotId);
      setAnimals(data.animals);
      setImports(data.importsByLot);
    }

    void loadRanchMap();
  }, [selectedRanchId]);

  useEffect(() => {
    writeStoredSelectedRanchId(selectedRanchId);
  }, [selectedRanchId]);

  const selectedRanch = ranches.find((ranch) => ranch._id === selectedRanchId) ?? null;
  const selectedLot = lots.find((lot) => lot._id === selectedLotId) ?? null;
  const visibleAnimals = selectedLotId ? animals.filter((animal) => animal.lotId === selectedLotId) : animals;
  const visibleImports = selectedLotId ? imports.filter((item) => item.lotId === selectedLotId) : imports;

  const lotById = useMemo(
    () => new Map(lots.map((lot) => [lot._id, lot])),
    [lots],
  );
  const activeAnimal = useMemo(
    () => animals.find((animal) => animal._id === activeAnimalId) ?? null,
    [activeAnimalId, animals],
  );

  const sortedVisibleAnimals = useMemo(() => {
    return [...visibleAnimals].sort((left, right) => {
      const leftLotName = lotById.get(left.lotId)?.name ?? "";
      const rightLotName = lotById.get(right.lotId)?.name ?? "";

      if (!selectedLotId && leftLotName !== rightLotName) {
        return leftLotName.localeCompare(rightLotName);
      }

      return (left.earTagNumber || "").localeCompare(right.earTagNumber || "");
    });
  }, [lotById, selectedLotId, visibleAnimals]);

  const activeAnimalImports = useMemo(() => {
    if (!activeAnimal) {
      return { items: [] as ImportItem[], mode: "none" as "none" | "direct" | "lot" };
    }

    const animalTokens = [
      activeAnimal.earTagNumber,
      activeAnimal.brandNumber,
      activeAnimal.name,
      activeAnimal.ixorigueAnimalId,
    ]
      .map((item) => normalizeSearchValue(item))
      .filter(Boolean);

    const directMatches = imports.filter((item) => {
      const haystack = normalizeSearchValue([item.filename, item.mimeType, item.status].filter(Boolean).join(" "));
      return animalTokens.some((token) => haystack.includes(token));
    });

    if (directMatches.length) {
      return { items: directMatches, mode: "direct" as const };
    }

    const lotMatches = imports.filter((item) => item.lotId === activeAnimal.lotId);
    if (lotMatches.length) {
      return { items: lotMatches, mode: "lot" as const };
    }

    return { items: [] as ImportItem[], mode: "none" as const };
  }, [activeAnimal, imports]);

  const mapLots = useMemo<MapLot[]>(
    () =>
      lots
        .filter((lot) => lot.geometry)
        .map((lot) => ({
          lotId: lot._id,
          farmId: lot.ranchId,
          name: lot.name,
          ixorigueId: lot.ixorigueLotId ?? lot._id,
          geometry: lot.geometry as { type: "Polygon"; coordinates: number[][][] },
        })),
    [lots],
  );

  const mapAnimals = useMemo(
    () =>
      animals
        .filter((animal) => animal.coordinates?.lat != null && animal.coordinates?.lng != null)
        .map((animal) => ({
          animalId: animal._id,
          lotId: animal.lotId,
          earTagNumber: animal.earTagNumber,
          lotName: lotById.get(animal.lotId)?.name ?? "Unknown lot",
          breed: animal.breed,
          sex: animal.sex,
          currentWeight: animal.currentWeight,
          coordinates: {
            lat: animal.coordinates!.lat,
            lng: animal.coordinates!.lng,
          },
        })),
    [animals, lotById],
  );

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Loading session...</main>;
  }

  if (!session) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-4 sm:p-6">
      <Script src="https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.js" strategy="afterInteractive" />
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Pastora Dashboard</h1>
              <p className="text-sm text-slate-600">{session.user.email} · {session.user.role}</p>
              {session.user.role === "institutional" ? (
                <p className="mt-1 text-xs text-slate-500">Institutional access is read-only across the admin workspace.</p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/profile" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Profile</Link>
              {hasAdminAccess ? (
                <>
                  <Link href="/dashboard/admin/users" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Users</Link>
                  <Link href="/dashboard/admin/phones" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Phones</Link>
                  <Link href="/dashboard/admin/ranches" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Ranches</Link>
                  <Link href="/dashboard/admin/lots" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Lots</Link>
                  <Link href="/dashboard/admin/animals" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Animals</Link>
                  <Link href="/dashboard/admin/data-error-requests" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Data Errors</Link>
                  <Link href="/dashboard/admin/sync-jobs" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Sync Jobs</Link>
                  <Link href="/dashboard/admin/ixorigue" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Ixorigue</Link>
                </>
              ) : null}
              <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-700">Sign out</button>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:max-w-[580px]">
              <label className="grid gap-2 text-sm text-slate-600">
                <span className="font-medium text-slate-700">Ranch</span>
                <select value={selectedRanchId} onChange={(event) => handleSelectRanch(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {ranches.map((ranch) => (
                    <option key={ranch._id} value={ranch._id}>{ranch.name} · {ranch.syncStatus}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-slate-600">
                <span className="font-medium text-slate-700">Lot</span>
                <select value={selectedLotId} onChange={(event) => handleSelectLot(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="">All lots</option>
                  {lots.map((lot) => (
                    <option key={lot._id} value={lot._id}>{lot.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ranch Summary</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Ranch</p>
                  <p className="text-sm font-medium text-slate-900">{selectedRanch?.name ?? "No ranch selected"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Lot</p>
                  <p className="text-sm font-medium text-slate-900">{selectedLot?.name ?? "All lots"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Animals</p>
                  <p className="text-sm font-medium text-slate-900">{visibleAnimals.length}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Sync status</p>
                  <p className="text-sm font-medium text-slate-900">{selectedRanch?.syncStatus ?? "unknown"}</p>
                </div>
              </div>
            </section>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr),minmax(300px,1fr)]">
          <div className="space-y-4">
            <MapView lots={mapLots} animals={mapAnimals} selectedLotId={selectedLotId || null} onSelectLot={handleSelectLot} />

            <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Imports</h2>
                  <p className="text-sm text-slate-500">
                    {selectedLotId ? `Files linked to ${selectedLot?.name ?? "selected lot"}` : "Files received across all lots in this ranch"}
                  </p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {visibleImports.length} import{visibleImports.length === 1 ? "" : "s"}
                </div>
              </div>

              {visibleImports.length ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {visibleImports.map((item) => {
                    const linkedLot = item.lotId ? lotById.get(item.lotId) : null;
                    const createdAt = new Date(item.createdAt);
                    return (
                      <article key={item._id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{item.filename}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {linkedLot?.name ?? "Unassigned lot"} · {item.mimeType ?? "Unknown file type"}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-4 space-y-1 text-sm text-slate-600">
                          <p>Received: {Number.isNaN(createdAt.getTime()) ? item.createdAt : createdAt.toLocaleString()}</p>
                          <p>Size: {item.sizeBytes ? `${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB` : "Unknown"}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  {selectedLotId ? "No imports linked to this lot yet." : "No WhatsApp imports received for this ranch yet."}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {selectedLot ? `Animals in ${selectedLot.name}` : "Animals in ranch"}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {selectedLot ? "Side panel focused on the selected lot." : "Choose a lot from the header or the map to narrow the list."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {sortedVisibleAnimals.length} animal{sortedVisibleAnimals.length === 1 ? "" : "s"}
                  </span>
                  {selectedLot ? (
                    <button type="button" onClick={() => handleSelectLot("")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
                      Clear lot
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {sortedVisibleAnimals.length ? sortedVisibleAnimals.map((animal) => (
                  <article key={animal._id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{animal.earTagNumber}</p>
                        <p className="mt-1 text-sm text-slate-500">{animal.name ?? animal.breed ?? "Unnamed animal"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                          {animal.currentWeight} kg
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveAnimalId(animal._id)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Info
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-slate-600">
                      {!selectedLotId ? <p>Lot: {lotById.get(animal.lotId)?.name ?? "Unknown lot"}</p> : null}
                      <p>Sex: {animal.sex || "-"}</p>
                      <p>Breed: {animal.breed || "-"}</p>
                      <p>Life status: {animal.lifeStatus}</p>
                      <p>Ixorigue: {animal.ixorigueAnimalId ?? "Local only"}</p>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    {selectedLotId ? "No animals found in this lot." : "No animals found for this ranch yet."}
                  </div>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>

      {activeAnimal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onClick={() => setActiveAnimalId(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Animal info</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">{activeAnimal.earTagNumber}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {activeAnimal.name ?? activeAnimal.breed ?? "Unnamed animal"} · {lotById.get(activeAnimal.lotId)?.name ?? "Unknown lot"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAnimalId(null)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
              <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Animal details</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-500">Lot</p>
                    <p className="text-sm font-medium text-slate-900">{lotById.get(activeAnimal.lotId)?.name ?? "Unknown lot"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Species</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.specie ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Breed</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.breed || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Sex</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.sex || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Color</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.color || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Brand number</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.brandNumber || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Current weight</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.currentWeight} kg</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Initial weight</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.initialWeight != null ? `${activeAnimal.initialWeight} kg` : "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Life status</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.lifeStatus}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Ixorigue ID</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.ixorigueAnimalId ?? "Local only"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Birth date</p>
                    <p className="text-sm font-medium text-slate-900">{formatDateTime(activeAnimal.birthDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Purchase date</p>
                    <p className="text-sm font-medium text-slate-900">{formatDateTime(activeAnimal.dateOfPurchase)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Register reason</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.registerReason ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Sync status</p>
                    <p className="text-sm font-medium text-slate-900">{activeAnimal.syncStatus ?? "-"}</p>
                  </div>
                </div>
                {activeAnimal.syncError ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Sync error: {activeAnimal.syncError}
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Animal imports</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {activeAnimalImports.mode === "direct"
                        ? "Matched directly from import filename or metadata."
                        : activeAnimalImports.mode === "lot"
                          ? `Imports are stored at lot level right now, so these are the imports for ${lotById.get(activeAnimal.lotId)?.name ?? "this lot"}.`
                          : "No imports linked to this animal were found."}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {activeAnimalImports.items.length} import{activeAnimalImports.items.length === 1 ? "" : "s"}
                  </span>
                </div>

                {activeAnimalImports.items.length ? (
                  <div className="mt-4 space-y-3">
                    {activeAnimalImports.items.map((item) => (
                      <article key={item._id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{item.filename}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {lotById.get(item.lotId ?? "")?.name ?? "Unassigned lot"} · {item.mimeType ?? "Unknown file type"}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-slate-600">
                          <p>Received: {formatDateTime(item.createdAt)}</p>
                          <p>Size: {formatSize(item.sizeBytes)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    No imports available for this animal yet.
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
