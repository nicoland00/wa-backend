"use client";

import Script from "next/script";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  sex: string;
  breed: string;
  color: string;
  brandNumber: string;
  earTagNumber: string;
  currentWeight: number;
  lifeStatus: "alive" | "dead";
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

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [selectedRanchId, setSelectedRanchId] = useState("");
  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [imports, setImports] = useState<ImportItem[]>([]);

  const hasAdminAccess = session ? canViewAdminScreens(session.user.role) : false;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

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
      setSelectedRanchId((current) => current || data.ranches[0]?._id || "");
    }

    async function loadUserRanches() {
      const response = await fetch("/api/my/ranches", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { ranches: Ranch[] };
      setRanches(data.ranches);
      setSelectedRanchId((current) => current || data.ranches[0]?._id || "");
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
        return;
      }

      const response = await fetch(`/api/map/ranch/${selectedRanchId}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as MapResponse;
      setLots(data.lots);
      setSelectedLotId((current) => (data.lots.some((lot) => lot._id === current) ? current : ""));
      setAnimals(data.animals);
      setImports(data.importsByLot);
    }

    void loadRanchMap();
  }, [selectedRanchId]);

  const selectedRanch = ranches.find((ranch) => ranch._id === selectedRanchId) ?? null;
  const selectedLot = lots.find((lot) => lot._id === selectedLotId) ?? null;
  const visibleAnimals = selectedLotId ? animals.filter((animal) => animal.lotId === selectedLotId) : animals;
  const visibleImports = selectedLotId ? imports.filter((item) => item.lotId === selectedLotId) : imports;

  const lotById = useMemo(
    () => new Map(lots.map((lot) => [lot._id, lot])),
    [lots],
  );

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

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(220px,280px),minmax(220px,280px),1fr]">
            <label className="grid gap-2 text-sm text-slate-600">
              <span className="font-medium text-slate-700">Ranch</span>
              <select value={selectedRanchId} onChange={(event) => setSelectedRanchId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                {ranches.map((ranch) => (
                  <option key={ranch._id} value={ranch._id}>{ranch.name} · {ranch.syncStatus}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm text-slate-600">
              <span className="font-medium text-slate-700">Lot</span>
              <select value={selectedLotId} onChange={(event) => setSelectedLotId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">All lots</option>
                {lots.map((lot) => (
                  <option key={lot._id} value={lot._id}>{lot.name}</option>
                ))}
              </select>
            </label>

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

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr),360px]">
          <div className="space-y-4">
            <MapView lots={mapLots} animals={mapAnimals} selectedLotId={selectedLotId || null} onSelectLot={(id) => setSelectedLotId(id)} />

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
                    {selectedLot ? `Animals in ${selectedLot.name}` : "Lots in ranch"}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {selectedLot ? "Side panel focused on the selected lot." : "Choose a lot from the header or the map."}
                  </p>
                </div>
                {selectedLot ? (
                  <button type="button" onClick={() => setSelectedLotId("")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
                    Clear lot
                  </button>
                ) : null}
              </div>

              {selectedLot ? (
                <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {visibleAnimals.length ? visibleAnimals.map((animal) => (
                    <article key={animal._id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{animal.earTagNumber}</p>
                          <p className="mt-1 text-sm text-slate-500">{animal.name ?? animal.breed ?? "Unnamed animal"}</p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                          {animal.currentWeight} kg
                        </span>
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-slate-600">
                        <p>Sex: {animal.sex || "-"}</p>
                        <p>Breed: {animal.breed || "-"}</p>
                        <p>Life status: {animal.lifeStatus}</p>
                        <p>Ixorigue: {animal.ixorigueAnimalId ?? "Local only"}</p>
                      </div>
                    </article>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      No animals found in this lot.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {lots.length ? lots.map((lot) => {
                    const lotAnimals = animals.filter((animal) => animal.lotId === lot._id);

                    return (
                      <button
                        key={lot._id}
                        type="button"
                        onClick={() => setSelectedLotId(lot._id)}
                        className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left hover:bg-slate-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{lot.name}</p>
                            <p className="mt-1 text-sm text-slate-500">Ixorigue: {lot.ixorigueLotId ?? "Local only"}</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                            {lot.animalCount ?? lotAnimals.length}
                          </span>
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      No lots available for this ranch.
                    </div>
                  )}
                </div>
              )}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
