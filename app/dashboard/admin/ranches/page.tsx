"use client";

import Script from "next/script";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import MapView from "@/components/MapView";
import type { Lot as MapLot } from "@/lib/api";

type User = { _id: string; email: string; name: string | null; role?: string };
type IxorigueRanch = { id: string; name: string | null; code?: string | null };
type RanchRow = {
  _id: string;
  ownerUserId: string;
  name: string;
  ixorigueRanchId: string | null;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string | null;
  lotCount: number;
  animalCount: number;
  owner: User | null;
};
type Lot = {
  _id: string;
  ranchId: string;
  name: string;
  ixorigueLotId: string | null;
  geometry?: { type: "Polygon"; coordinates: number[][][] } | null;
  animalCount?: number;
};
type Animal = {
  _id: string;
  lotId: string;
  earTagNumber: string;
  breed: string;
  currentWeight: number;
  ixorigueAnimalId: string | null;
  sex?: string;
  specie?: string | null;
  coordinates?: { lat: number; lng: number } | null;
};
type RanchDetails = {
  ranch: RanchRow;
  owner: User | null;
  lots: Lot[];
  animals: Animal[];
  lotSummaries: Array<{ lot: Lot; animalCount: number; animals: Animal[] }>;
};
type MapResponse = {
  lots: Lot[];
  animals: Animal[];
};

export default function AdminRanchesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [ixorigueRanches, setIxorigueRanches] = useState<IxorigueRanch[]>([]);
  const [ranches, setRanches] = useState<RanchRow[]>([]);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [ixorigueRanchId, setIxorigueRanchId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRanchId, setSelectedRanchId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [details, setDetails] = useState<RanchDetails | null>(null);
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [reassignOwnerId, setReassignOwnerId] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || session?.user.role !== "admin") {
      return;
    }

    async function load() {
      const [usersRes, ixorigueRes, ranchesRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/ixorigue/ranches", { cache: "no-store" }),
        fetch("/api/admin/ranches", { cache: "no-store" }),
      ]);

      if (usersRes.ok) {
        const usersData = (await usersRes.json()) as { users: User[] };
        const eligibleUsers = usersData.users.filter((user) => user.role !== "admin");
        setUsers(eligibleUsers);
        setOwnerUserId((current) => current || eligibleUsers[0]?._id || "");
        setSelectedUserId((current) => current || eligibleUsers[0]?._id || "");
      }

      if (ixorigueRes.ok) {
        const ixorigueData = (await ixorigueRes.json()) as { ranches: IxorigueRanch[] };
        setIxorigueRanches(ixorigueData.ranches);
        setIxorigueRanchId((current) => current || ixorigueData.ranches[0]?.id || "");
      }

      if (ranchesRes.ok) {
        const ranchesData = (await ranchesRes.json()) as { ranches: RanchRow[] };
        setRanches(ranchesData.ranches);
        setReassignOwnerId((current) => current || ranchesData.ranches[0]?.ownerUserId || "");
      }
    }

    void load();
  }, [session?.user.role, status]);

  const filteredRanches = useMemo(
    () => ranches.filter((ranch) => !selectedUserId || ranch.ownerUserId === selectedUserId),
    [ranches, selectedUserId],
  );

  useEffect(() => {
    setSelectedRanchId((current) => (filteredRanches.some((ranch) => ranch._id === current) ? current : filteredRanches[0]?._id || ""));
  }, [filteredRanches]);

  useEffect(() => {
    async function loadDetails() {
      if (!selectedRanchId) {
        setDetails(null);
        setMapData(null);
        setSelectedLotId("");
        return;
      }

      const [detailsRes, mapRes] = await Promise.all([
        fetch(`/api/admin/ranches/${selectedRanchId}`, { cache: "no-store" }),
        fetch(`/api/map/ranch/${selectedRanchId}`, { cache: "no-store" }),
      ]);

      if (detailsRes.ok) {
        const data = (await detailsRes.json()) as RanchDetails;
        setDetails(data);
        setSelectedLotId((current) => (data.lots.some((lot) => lot._id === current) ? current : ""));
      } else {
        setDetails(null);
      }

      if (mapRes.ok) {
        const map = (await mapRes.json()) as MapResponse;
        setMapData(map);
      } else {
        setMapData(null);
      }
    }

    void loadDetails();
  }, [selectedRanchId]);

  async function refreshRanches(nextSelectedId?: string) {
    const response = await fetch("/api/admin/ranches", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as { ranches: RanchRow[] };
    setRanches(data.ranches);
    if (nextSelectedId) {
      setSelectedRanchId(nextSelectedId);
    }
  }

  async function assignRanch() {
    setBusyAction("assign");
    const response = await fetch("/api/admin/ranches/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerUserId, ixorigueRanchId }),
    });
    const data = (await response.json()) as { error?: string; ranch?: { _id: string } };
    setMessage(response.ok ? "Ranch assigned and remote structure synced." : data.error ?? "Assignment failed.");
    if (response.ok) {
      setSelectedUserId(ownerUserId);
      await refreshRanches(data.ranch?._id);
    }
    setBusyAction(null);
  }

  async function moveRanchToUser() {
    const ranch = ranches.find((item) => item._id === selectedRanchId);
    if (!ranch || !reassignOwnerId || !ranch.ixorigueRanchId) {
      return;
    }
    setBusyAction("reassign");
    const response = await fetch("/api/admin/ranches/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerUserId: reassignOwnerId, ixorigueRanchId: ranch.ixorigueRanchId }),
    });
    const data = (await response.json()) as { error?: string; ranch?: { _id: string } };
    setMessage(response.ok ? "Ranch moved to the selected user." : data.error ?? "Ranch move failed.");
    if (response.ok) {
      setSelectedUserId(reassignOwnerId);
      await refreshRanches(data.ranch?._id ?? selectedRanchId);
    }
    setBusyAction(null);
  }

  async function runSync(action: "sync-lots" | "sync-animals" | "sync-remote") {
    if (!selectedRanchId) {
      return;
    }
    setBusyAction(action);
    const response = await fetch(`/api/admin/ranches/${selectedRanchId}/${action}`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Remote sync completed." : data.error ?? "Sync failed.");
    if (response.ok) {
      await refreshRanches(selectedRanchId);
      const [detailsRes, mapRes] = await Promise.all([
        fetch(`/api/admin/ranches/${selectedRanchId}`, { cache: "no-store" }),
        fetch(`/api/map/ranch/${selectedRanchId}`, { cache: "no-store" }),
      ]);
      if (detailsRes.ok) {
        setDetails((await detailsRes.json()) as RanchDetails);
      }
      if (mapRes.ok) {
        setMapData((await mapRes.json()) as MapResponse);
      }
    }
    setBusyAction(null);
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  }
  if (session?.user.role !== "admin") {
    return <main className="p-6 text-sm text-slate-600">Forbidden</main>;
  }

  const visibleLots = details?.lots ?? [];
  const visibleAnimals = selectedLotId ? (details?.animals ?? []).filter((animal) => animal.lotId === selectedLotId) : (details?.animals ?? []);
  const selectedLot = visibleLots.find((lot) => lot._id === selectedLotId) ?? null;
  const ranchCountByUser = ranches.reduce<Record<string, number>>((acc, ranch) => {
    acc[ranch.ownerUserId] = (acc[ranch.ownerUserId] ?? 0) + 1;
    return acc;
  }, {});
  const mapLots = (mapData?.lots ?? [])
    .filter((lot) => lot.geometry)
    .map((lot) => ({
      lotId: lot._id,
      farmId: lot.ranchId,
      name: lot.name,
      ixorigueId: lot.ixorigueLotId ?? lot._id,
      geometry: lot.geometry as { type: "Polygon"; coordinates: number[][][] },
    })) satisfies MapLot[];
  const mapAnimals = (mapData?.animals ?? [])
    .filter((animal) => animal.coordinates?.lat != null && animal.coordinates?.lng != null)
    .map((animal) => ({
      animalId: animal._id,
      lotId: animal.lotId,
      earTagNumber: animal.earTagNumber,
      coordinates: {
        lat: animal.coordinates!.lat,
        lng: animal.coordinates!.lng,
      },
    }));

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <Script src="https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.js" strategy="afterInteractive" />
      <div className="mx-auto max-w-7xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Ranch Explorer</h1>
          <p className="mt-1 text-sm text-slate-600">Navigate from users to ranches, then lots, then animals. Use the quick create buttons to add new records in context.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {users.map((user) => (
                <option key={user._id} value={user._id}>{user.name ?? user.email}</option>
              ))}
            </select>
            <select value={ixorigueRanchId} onChange={(event) => setIxorigueRanchId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {ixorigueRanches.map((ranch) => (
                <option key={ranch.id} value={ranch.id}>{ranch.name ?? ranch.code ?? ranch.id}</option>
              ))}
            </select>
            <button type="button" onClick={() => void assignRanch()} disabled={!ownerUserId || !ixorigueRanchId || busyAction !== null} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-60">
              {busyAction === "assign" ? "Assigning..." : "+ Assign ranch"}
            </button>
          </div>
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
        </section>

        <section className="grid gap-4 xl:grid-cols-[320px,1fr]">
          <aside className="space-y-4">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Users</h2>
                <span className="text-xs text-slate-500">{users.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {users.map((user) => (
                  <button key={user._id} type="button" onClick={() => setSelectedUserId(user._id)} className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${selectedUserId === user._id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{user.name ?? user.email}</p>
                        <p className="text-slate-500">{user.email}</p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                        {ranchCountByUser[user._id] ?? 0} ranches
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Ranches</h2>
                <span className="text-xs text-slate-500">{filteredRanches.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {filteredRanches.length ? filteredRanches.map((ranch) => (
                  <button key={ranch._id} type="button" onClick={() => setSelectedRanchId(ranch._id)} className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${selectedRanchId === ranch._id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                    <p className="font-medium text-slate-900">{ranch.name}</p>
                    <p className="text-slate-500">{ranch.lotCount} lots · {ranch.animalCount} animals</p>
                    <p className="mt-1 text-xs text-slate-500">{ranch.syncStatus}{ranch.syncError ? ` · ${ranch.syncError}` : ""}</p>
                  </button>
                )) : <p className="text-sm text-slate-500">This user has no ranches linked yet.</p>}
              </div>
            </section>
          </aside>

          <div className="space-y-4">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{details?.ranch.name ?? "Select a ranch"}</h2>
                  <p className="text-sm text-slate-600">{details?.owner?.name ?? details?.owner?.email ?? "No owner"} · {details?.ranch.ixorigueRanchId ?? "No Ixorigue link"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={reassignOwnerId} onChange={(event) => setReassignOwnerId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {users.map((user) => (
                      <option key={user._id} value={user._id}>{user.name ?? user.email}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void moveRanchToUser()} disabled={!selectedRanchId || !reassignOwnerId || busyAction !== null} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">
                    {busyAction === "reassign" ? "Moving..." : "Assign to another user"}
                  </button>
                  <button type="button" onClick={() => void runSync("sync-lots")} disabled={!selectedRanchId || busyAction !== null} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">Sync lots</button>
                  <button type="button" onClick={() => void runSync("sync-animals")} disabled={!selectedRanchId || busyAction !== null} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">Sync animals</button>
                  <button type="button" onClick={() => void runSync("sync-remote")} disabled={!selectedRanchId || busyAction !== null} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-60">Sync all</button>
                </div>
              </div>
              {selectedRanchId ? (
                <div className="mt-4">
                  <MapView lots={mapLots} animals={mapAnimals} selectedLotId={selectedLotId || null} onSelectLot={(id) => setSelectedLotId(id)} />
                </div>
              ) : null}
            </section>

            <section className="grid gap-4 lg:grid-cols-[280px,1fr]">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">Lots</h2>
                  {selectedRanchId ? (
                    <Link href={`/dashboard/admin/lots?ranchId=${selectedRanchId}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">+ New lot</Link>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2">
                  <button type="button" onClick={() => setSelectedLotId("")} className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${selectedLotId === "" ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                    <p className="font-medium text-slate-900">All lots</p>
                    <p className="text-slate-500">{details?.animals.length ?? 0} animals in ranch</p>
                  </button>
                  {visibleLots.map((lot) => (
                    <button key={lot._id} type="button" onClick={() => setSelectedLotId(lot._id)} className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${selectedLotId === lot._id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                      <p className="font-medium text-slate-900">{lot.name}</p>
                      <p className="text-slate-500">{lot.animalCount ?? details?.animals.filter((animal) => animal.lotId === lot._id).length ?? 0} animals</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">{selectedLot ? `Animals in ${selectedLot.name}` : "Animals in ranch"}</h2>
                    <p className="text-sm text-slate-500">{visibleAnimals.length} listed</p>
                  </div>
                  {selectedRanchId ? (
                    <Link href={`/dashboard/admin/animals?ranchId=${selectedRanchId}${selectedLotId ? `&lotId=${selectedLotId}` : ""}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">+ New animal</Link>
                  ) : null}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="px-3 py-2">Ear tag</th>
                        <th className="px-3 py-2">Specie</th>
                        <th className="px-3 py-2">Sex</th>
                        <th className="px-3 py-2">Breed</th>
                        <th className="px-3 py-2">Weight</th>
                        <th className="px-3 py-2">Ixorigue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAnimals.length ? visibleAnimals.map((animal) => (
                        <tr key={animal._id} className="border-b border-slate-100 text-slate-700">
                          <td className="px-3 py-2">{animal.earTagNumber}</td>
                          <td className="px-3 py-2">{animal.specie ?? "-"}</td>
                          <td className="px-3 py-2">{animal.sex ?? "-"}</td>
                          <td className="px-3 py-2">{animal.breed || "-"}</td>
                          <td className="px-3 py-2">{animal.currentWeight}</td>
                          <td className="px-3 py-2 font-mono text-xs">{animal.ixorigueAnimalId ?? "—"}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">No animals found for this selection.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
