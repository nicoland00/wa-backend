"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type DataErrorRequest = {
  _id: string;
  ranchId: string | null;
  lotId: string | null;
  animalId: string | null;
  reportedByUserId: string;
  message: string;
  status: "open" | "resolved" | "rejected";
  createdAt: string;
};

export default function AdminDataErrorRequestsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [requests, setRequests] = useState<DataErrorRequest[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || session?.user.role !== "admin") {
      return;
    }

    async function loadRequests() {
      const response = await fetch("/api/admin/data-error-requests", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { requests: DataErrorRequest[] };
      setRequests(data.requests);
    }

    void loadRequests();
  }, [session?.user.role, status]);

  async function resolveRequest(id: string, statusValue: "resolved" | "rejected") {
    const response = await fetch(`/api/admin/data-error-requests/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: statusValue }),
    });
    setMessage(response.ok ? "Request updated." : "Failed to update request.");
    if (response.ok) {
      setRequests((current) => current.map((item) => (item._id === id ? { ...item, status: statusValue } : item)));
    }
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  }
  if (session?.user.role !== "admin") {
    return <main className="p-6 text-sm text-slate-600">Forbidden</main>;
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Data Error Requests</h1>
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item) => (
                  <tr key={item._id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{item.animalId ?? item.lotId ?? item.ranchId ?? "general"}</td>
                    <td className="px-3 py-2">{item.message}</td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void resolveRequest(item._id, "resolved")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">Resolve</button>
                        <button type="button" onClick={() => void resolveRequest(item._id, "rejected")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">Reject</button>
                      </div>
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
