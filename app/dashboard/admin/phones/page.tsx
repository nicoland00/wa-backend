"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canApprovePhones, canViewAdminScreens } from "@/lib/permissions";

type PendingUser = {
  userId: string;
  email: string;
  name: string | null;
  phoneE164: string | null;
  phoneStatus: "pending";
  updatedAt: string;
};

export default function AdminPhonesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const canView = session ? canViewAdminScreens(session.user.role) : false;
  const canDecide = session ? canApprovePhones(session.user.role) : false;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) {
      return;
    }

    async function fetchPending() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/admin/phones/pending", { cache: "no-store" });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          setError(data.error ?? "No se pudo cargar la lista.");
          return;
        }

        const data = (await response.json()) as { users: PendingUser[] };
        setPending(data.users);
      } finally {
        setLoading(false);
      }
    }

    void fetchPending();
  }, [canView, status]);

  async function decide(userId: string, decision: "approved" | "rejected") {
    const response = await fetch("/api/admin/phones/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, decision }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "No se pudo aplicar la decisión.");
      return;
    }

    setPending((current) => current.filter((item) => item.userId !== userId));
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Cargando sesión...</main>;
  }

  if (!canView) {
    return (
      <main className="min-h-screen bg-[#f7f9fb] p-6">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-sm text-slate-700 shadow-sm">
          <p>403 - No tienes permisos para acceder a esta página.</p>
          <Link href="/dashboard" className="mt-3 inline-block text-slate-900 underline">
            Volver al dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <Link href="/dashboard" className="inline-block text-sm text-slate-600 hover:text-slate-900">
          ← Volver al dashboard
        </Link>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Solicitudes pendientes de teléfono</h1>
          {!canDecide ? (
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Institutional users can review pending requests here, but approval decisions remain admin-only.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

          {loading ? <p className="mt-4 text-sm text-slate-600">Cargando...</p> : null}

          {!loading && pending.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No hay solicitudes pendientes.</p>
          ) : null}

          {pending.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Nombre</th>
                    <th className="px-3 py-2 font-medium">Teléfono</th>
                    <th className="px-3 py-2 font-medium">Actualizado</th>
                    <th className="px-3 py-2 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((item) => (
                    <tr key={item.userId} className="border-b border-slate-100 text-slate-700">
                      <td className="px-3 py-2">{item.email}</td>
                      <td className="px-3 py-2">{item.name ?? "-"}</td>
                      <td className="px-3 py-2">{item.phoneE164 ?? "-"}</td>
                      <td className="px-3 py-2">{new Date(item.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void decide(item.userId, "approved")}
                            disabled={!canDecide}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            onClick={() => void decide(item.userId, "rejected")}
                            disabled={!canDecide}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
                          >
                            Rechazar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
