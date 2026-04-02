"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CreateResponse = { farmId: string };

export default function NewFarmPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ixorigueRanchId, setIxorigueRanchId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function createFarm() {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/farms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ixorigueRanchId }),
      });

      const data = (await response.json()) as CreateResponse & { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Failed to create farm");
        return;
      }

      router.push(`/dashboard/onboarding/farm/${data.farmId}/lots`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Create Farm Draft</h1>
          <div className="mt-4 space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Farm name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input value={ixorigueRanchId} onChange={(e) => setIxorigueRanchId(e.target.value)} placeholder="ixorigueRanchId" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <button type="button" disabled={loading} onClick={() => void createFarm()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">
              {loading ? "Creating..." : "Create draft"}
            </button>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
