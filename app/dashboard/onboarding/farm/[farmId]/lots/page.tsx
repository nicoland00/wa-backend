"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Farm = { _id: string; name: string; status: "draft" | "pending" | "approved" | "rejected"; lotsLockedAt: string | null };
type Lot = { _id: string; name: string; ixorigueLotId: string };

export default function FarmLotsOnboardingPage() {
  const params = useParams<{ farmId: string }>();
  const router = useRouter();
  const farmId = params.farmId;

  const [farm, setFarm] = useState<Farm | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [name, setName] = useState("");
  const [ixorigueLotId, setIxorigueLotId] = useState("");
  const [geometry, setGeometry] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function refresh() {
      const [farmRes, lotsRes] = await Promise.all([
        fetch(`/api/farms/${farmId}`, { cache: "no-store" }),
        fetch(`/api/lots?farmId=${farmId}`, { cache: "no-store" }),
      ]);

      if (farmRes.ok) {
        const data = (await farmRes.json()) as Farm;
        setFarm(data);
      }

      if (lotsRes.ok) {
        const data = (await lotsRes.json()) as { lots: Lot[] };
        setLots(data.lots);
      }
    }

    void refresh();
  }, [farmId]);

  async function addLot() {
    setError("");

    let parsedGeometry: unknown = null;
    if (geometry.trim()) {
      try {
        parsedGeometry = JSON.parse(geometry);
      } catch {
        setError("Invalid geometry JSON");
        return;
      }
    }

    const response = await fetch("/api/lots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ farmId, name, ixorigueLotId, geometry: parsedGeometry }),
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to add lot");
      return;
    }

    setName("");
    setIxorigueLotId("");
    setGeometry("");

    const lotsRes = await fetch(`/api/lots?farmId=${farmId}`, { cache: "no-store" });
    if (lotsRes.ok) {
      const lotsData = (await lotsRes.json()) as { lots: Lot[] };
      setLots(lotsData.lots);
    }
  }

  async function submitFarm() {
    const response = await fetch(`/api/farms/${farmId}/submit`, { method: "POST" });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Failed to submit farm");
      return;
    }

    router.push("/dashboard");
  }

  const editable = farm?.status === "draft" && !farm?.lotsLockedAt;

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Farm Lots Onboarding</h1>
          <p className="mt-1 text-sm text-slate-600">status: {farm?.status ?? "-"}</p>

          {editable ? (
            <div className="mt-4 space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lot name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={ixorigueLotId} onChange={(e) => setIxorigueLotId(e.target.value)} placeholder="ixorigueLotId" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <textarea value={geometry} onChange={(e) => setGeometry(e.target.value)} placeholder='Optional GeoJSON Polygon' className="min-h-32 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <button type="button" onClick={() => void addLot()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">Add lot</button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">Lots are locked for this farm.</p>
          )}

          <div className="mt-6 border-t border-slate-100 pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Lots</h2>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {lots.map((lot) => (
                <li key={lot._id}>{lot.name} · {lot.ixorigueLotId}</li>
              ))}
            </ul>
          </div>

          {editable ? (
            <button type="button" onClick={() => void submitFarm()} className="mt-6 rounded-lg bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-600">
              Submit farm for approval
            </button>
          ) : null}

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
