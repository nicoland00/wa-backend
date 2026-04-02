"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

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

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || session?.user.role !== "admin") {
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
  }, [session?.user.role, status]);

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
          <h1 className="text-xl font-semibold text-slate-900">Sync Jobs</h1>
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
