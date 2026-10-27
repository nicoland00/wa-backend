"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canViewAdminScreens } from "@/lib/permissions";

type SyncJob = {
  _id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

export default function AdminSyncJobsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const canView = session ? canViewAdminScreens(session.user.role) : false;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) {
      return;
    }

    async function loadJobs() {
      const response = await fetch("/api/admin/sync-jobs", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { syncJobs: SyncJob[] };
      setJobs(data.syncJobs);
    }

    void loadJobs();
  }, [canView, status]);

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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sincronización</h1>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job._id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{job.entityType} · {job.entityId}</td>
                    <td className="px-3 py-2">{job.action}</td>
                    <td className="px-3 py-2">{job.status}</td>
                    <td className="px-3 py-2">{job.attempts}</td>
                    <td className="px-3 py-2">{job.lastError ?? "-"}</td>
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
