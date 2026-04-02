"use client";

import Script from "next/script";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import MapView from "@/components/MapView";
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
  lotId: string | null;
  filename: string;
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
  const [selectedAnimalId, setSelectedAnimalId] = useState("");
  const [weightValue, setWeightValue] = useState("");
  const [issueMessage, setIssueMessage] = useState("");
  const [feedback, setFeedback] = useState("");

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
      if (session?.user.role === "admin") {
        const response = await fetch("/api/admin/ranches", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { ranches: Ranch[] };
        setRanches(data.ranches);
        setSelectedRanchId((current) => current || data.ranches[0]?._id || "");
        return;
      }

      const response = await fetch("/api/my/ranch", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { ranch: Ranch | null };
      setRanches(data.ranch ? [data.ranch] : []);
      setSelectedRanchId(data.ranch?._id ?? "");
    }

    void loadRanches();
  }, [session?.user.role, status]);

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
      setSelectedLotId("");
      setAnimals(data.animals);
      setImports(data.importsByLot);
      setSelectedAnimalId((current) => current || data.animals[0]?._id || "");
    }

    void loadRanchMap();
  }, [selectedRanchId]);

  const selectedLot = lots.find((lot) => lot._id === selectedLotId) ?? null;
  const visibleAnimals = selectedLotId ? animals.filter((animal) => animal.lotId === selectedLotId) : animals;
  const visibleImports = selectedLotId ? imports.filter((item) => item.lotId === selectedLotId) : imports;
  const selectedAnimal = visibleAnimals.find((animal) => animal._id === selectedAnimalId) ?? visibleAnimals[0] ?? null;

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
          coordinates: {
            lat: animal.coordinates!.lat,
            lng: animal.coordinates!.lng,
          },
        })),
    [animals],
  );

  async function refreshMap() {
    const response = await fetch(`/api/map/ranch/${selectedRanchId}`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const next = (await response.json()) as MapResponse;
    setLots(next.lots);
    setAnimals(next.animals);
    setImports(next.importsByLot);
  }

  async function submitWeight() {
    if (!selectedAnimalId || !weightValue) {
      return;
    }

    const response = await fetch(`/api/my/animals/${selectedAnimalId}/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weight: Number(weightValue) }),
    });

    const data = (await response.json()) as { error?: string };
    setFeedback(response.ok ? "Weight submitted." : data.error ?? "Weight update failed.");
    if (response.ok) {
      setWeightValue("");
      await refreshMap();
    }
  }

  async function submitIssue() {
    const response = await fetch("/api/my/data-error-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ranchId: selectedRanchId || null,
        lotId: selectedLotId || null,
        animalId: selectedAnimalId || null,
        message: issueMessage,
      }),
    });
    const data = (await response.json()) as { error?: string };
    setFeedback(response.ok ? "Issue reported." : data.error ?? "Failed to report issue.");
    if (response.ok) {
      setIssueMessage("");
    }
  }

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
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/profile" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Profile</Link>
              {session.user.role === "admin" ? (
                <>
                  <Link href="/dashboard/admin/users" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Users</Link>
                  <Link href="/dashboard/admin/ranches" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Ranches</Link>
                  <Link href="/dashboard/admin/lots" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Lots</Link>
                  <Link href="/dashboard/admin/animals" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Animals</Link>
                </>
              ) : null}
              <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-700">Sign out</button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-sm text-slate-600">Ranch</label>
            <select value={selectedRanchId} onChange={(event) => setSelectedRanchId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {ranches.map((ranch) => (
                <option key={ranch._id} value={ranch._id}>{ranch.name} · {ranch.syncStatus}</option>
              ))}
            </select>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-10">
          <div className="lg:col-span-7">
            <MapView lots={mapLots} animals={mapAnimals} selectedLotId={selectedLotId || null} onSelectLot={(id) => setSelectedLotId(id)} />
          </div>

          <aside className="space-y-4 lg:col-span-3">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Ranch Summary</h2>
              <div className="mt-3 space-y-1 text-sm text-slate-700">
                  <p>{ranches.find((ranch) => ranch._id === selectedRanchId)?.name ?? "No ranch selected"}</p>
                  <p>{lots.length} lots cached</p>
                  <p>{animals.length} animals cached</p>
                  <p>{mapAnimals.length} animals with coordinates</p>
                </div>
              </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Selected Lot</h2>
              {selectedLot ? (
                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  <p>{selectedLot.name}</p>
                  <p>Ixorigue lot: {selectedLot.ixorigueLotId ?? "Local only"}</p>
                  <p>{selectedLot.animalCount ?? visibleAnimals.length} animals</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Showing all ranch animals. Click a lot polygon to filter.</p>
              )}
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Imports</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {visibleImports.length ? visibleImports.slice(0, 8).map((item) => <li key={item._id}>{item.filename} · {item.status}</li>) : <li className="text-slate-500">{selectedLotId ? "No imports for this lot." : "No imports in this ranch."}</li>}
              </ul>
            </section>
          </aside>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">{selectedLotId ? "Animals by Lot" : "Animals in Ranch"}</h2>
              <select value={selectedLotId} onChange={(event) => setSelectedLotId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">All lots</option>
                {lots.map((lot) => (
                  <option key={lot._id} value={lot._id}>{lot.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-4 space-y-3">
              {visibleAnimals.length ? visibleAnimals.map((animal) => (
                <button key={animal._id} type="button" onClick={() => setSelectedAnimalId(animal._id)} className={`w-full rounded-2xl border p-4 text-left ${selectedAnimalId === animal._id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                  <p className="text-sm font-medium text-slate-900">{animal.earTagNumber}</p>
                  <p className="mt-1 text-sm text-slate-700">{animal.sex} · {animal.breed}</p>
                  <p className="mt-1 text-sm text-slate-500">{animal.currentWeight} kg · {animal.lifeStatus}</p>
                </button>
              )) : <p className="text-sm text-slate-500">{selectedLotId ? "No animals in this lot." : "No animals in this ranch."}</p>}
            </div>
          </section>

          <section className="space-y-4">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Animal Details</h2>
              {selectedAnimal ? (
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <p className="font-medium text-slate-900">{selectedAnimal.earTagNumber}</p>
                  <p>{selectedAnimal.sex} · {selectedAnimal.breed}</p>
                  <p>Color: {selectedAnimal.color || "Not set"}</p>
                  <p>Brand: {selectedAnimal.brandNumber || "Not set"}</p>
                  <p>Current weight: {selectedAnimal.currentWeight} kg</p>
                  <p>Ixorigue animal: {selectedAnimal.ixorigueAnimalId ?? "Local only"}</p>
                  {selectedAnimal.photoUrl ? <img src={selectedAnimal.photoUrl} alt={selectedAnimal.earTagNumber} className="h-36 w-36 rounded-xl object-cover" /> : null}
                  {selectedAnimal.videoUrl ? <a href={selectedAnimal.videoUrl} className="text-blue-700 underline">Open video</a> : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Select an animal to see details.</p>
              )}
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Allowed Actions</h2>
              <div className="mt-3 space-y-3">
                <input value={weightValue} onChange={(event) => setWeightValue(event.target.value)} placeholder="Weight" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <button type="button" onClick={() => void submitWeight()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">Submit weight</button>
                {session.user.role !== "admin" ? (
                  <>
                    <textarea value={issueMessage} onChange={(event) => setIssueMessage(event.target.value)} placeholder="Describe the problem" className="min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <button type="button" onClick={() => void submitIssue()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-600">Report data issue</button>
                  </>
                ) : null}
              </div>
            </section>

            {feedback ? <p className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-sm">{feedback}</p> : null}
          </section>
        </section>
      </div>
    </main>
  );
}
