"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canMutateAdminData, canViewAdminScreens } from "@/lib/permissions";

type PendingFarm = {
  _id: string;
  name: string;
  ixorigueRanchId: string;
  ownerUserId: string;
  submittedAt: string | null;
};

export default function AdminFarmsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [farms, setFarms] = useState<PendingFarm[]>([]);
  const canView = session ? canViewAdminScreens(session.user.role) : false;
  const canManage = session ? canMutateAdminData(session.user.role) : false;

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) return;

    async function run() {
      const res = await fetch("/api/admin/farms/pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { farms: PendingFarm[] };
      setFarms(data.farms);
    }

    void run();
  }, [canView, status]);

  async function decide(farmId: string, decision: "approved" | "rejected") {
    const response = await fetch(`/api/admin/farms/${farmId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, rejectionReason: decision === "rejected" ? "Rejected by admin" : undefined }),
    });

    if (response.ok) {
      setFarms((items) => items.filter((item) => item._id !== farmId));
    }
  }

  if (status === "loading") return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  if (!canView) return <main className="p-6 text-sm text-slate-600">Forbidden</main>;

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Pending farm approvals</h1>
          {!canManage ? <p className="mt-3 text-sm text-slate-600">Institutional users can review pending farms here, but only admins can approve or reject them.</p> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">ixorigueRanchId</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {farms.map((farm) => (
                  <tr key={farm._id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{farm.name}</td>
                    <td className="px-3 py-2">{farm.ixorigueRanchId}</td>
                    <td className="px-3 py-2">{farm.ownerUserId}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <div className="flex gap-2">
                          <button onClick={() => void decide(farm._id, "approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500">Approve</button>
                          <button onClick={() => void decide(farm._id, "rejected")} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-500">Reject</button>
                        </div>
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
