"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canMutateAdminData, canViewAdminScreens } from "@/lib/permissions";

type Ranch = { _id: string; name: string; syncStatus?: string };
type Lot = {
  _id: string;
  ranchId: string;
  name: string;
  ixorigueLotId: string | null;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string | null;
};

export default function AdminLotsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [ranchId, setRanchId] = useState("");
  const [name, setName] = useState("");
  const [geometry, setGeometry] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const canView = session ? canViewAdminScreens(session.user.role) : false;
  const canManage = session ? canMutateAdminData(session.user.role) : false;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) {
      return;
    }

    async function loadRanches() {
      const response = await fetch("/api/admin/ranches", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { ranches: Ranch[] };
      setRanches(data.ranches);
      const requestedRanchId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ranchId") : null;
      setRanchId((current) => current || (requestedRanchId && data.ranches.some((ranch) => ranch._id === requestedRanchId) ? requestedRanchId : data.ranches[0]?._id || ""));
    }

    void loadRanches();
  }, [canView, status]);

  useEffect(() => {
    async function loadLots() {
      if (!ranchId) {
        setLots([]);
        return;
      }
      const response = await fetch(`/api/admin/lots?ranchId=${ranchId}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { lots: Lot[] };
      setLots(data.lots);
    }

    void loadLots();
  }, [ranchId]);

  async function createLot() {
    let parsedGeometry = null;
    if (geometry.trim()) {
      try {
        parsedGeometry = JSON.parse(geometry);
      } catch {
        setMessage("Geometry must be valid GeoJSON.");
        return;
      }
    }

    const response = await fetch("/api/admin/lots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ranchId, name, geometry: parsedGeometry }),
    });
    const data = (await response.json()) as { error?: string; lot?: Lot };
    setMessage(response.ok ? "Lot created." : data.error ?? "Failed to create lot.");
    if (response.ok && data.lot) {
      const lot = data.lot;
      setLots((current) => [lot, ...current]);
      setName("");
      setGeometry("");
    }
  }

  async function retrySync(lotId: string) {
    const response = await fetch(`/api/admin/lots/${lotId}/retry-sync`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Sync retried." : data.error ?? "Retry failed.");
  }

  async function syncRemoteLots() {
    if (!ranchId) {
      return;
    }
    setSyncing(true);
    const response = await fetch(`/api/admin/ranches/${ranchId}/sync-lots`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Remote lots synced." : data.error ?? "Remote sync failed.");
    if (response.ok) {
      const refresh = await fetch(`/api/admin/lots?ranchId=${ranchId}`, { cache: "no-store" });
      if (refresh.ok) {
        const next = (await refresh.json()) as { lots: Lot[] };
        setLots(next.lots);
      }
    }
    setSyncing(false);
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Cargando…</main>;
  }
  if (!canView) {
    return <main className="p-6 text-sm text-slate-600">No tienes acceso a esta sección.</main>;
  }

  return (
    <main className="min-h-screen bg-[#f6f7f4] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-lg border border-[#e1e5e1] bg-white p-5 shadow-none">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Lotes</h1>
          <p className="mt-1 text-sm text-slate-600">Browse and manage lots for each ranch.</p>
          <div className="mt-4 space-y-3">
            <select value={ranchId} onChange={(event) => setRanchId(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {ranches.map((ranch) => (
                <option key={ranch._id} value={ranch._id}>{ranch.name}</option>
              ))}
            </select>
            {canManage ? (
              <>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Lot name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <textarea value={geometry} onChange={(event) => setGeometry(event.target.value)} placeholder='Optional GeoJSON polygon' className="min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void createLot()} className="rounded-lg bg-[#31574b] px-4 py-2 text-sm text-white hover:bg-[#27483e]">Create lot</button>
                  <button type="button" onClick={() => void syncRemoteLots()} disabled={!ranchId || syncing} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">
                    {syncing ? "Syncing..." : "Pull remote lots"}
                  </button>
                </div>
              </>
            ) : (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Institutional users can review lots here, but lot creation and sync actions remain admin-only.
              </p>
            )}
          </div>
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
        </section>

        <section className="rounded-lg border border-[#e1e5e1] bg-white p-5 shadow-none">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Sync</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot._id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{lot.name}</td>
                    <td className="px-3 py-2">{lot.ixorigueLotId ?? "pending"}</td>
                    <td className="px-3 py-2">{lot.syncStatus}{lot.syncError ? ` · ${lot.syncError}` : ""}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <button type="button" onClick={() => void retrySync(lot._id)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
                          Retry sync
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
