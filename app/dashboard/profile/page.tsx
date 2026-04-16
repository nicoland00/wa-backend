"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/db/types";

type MeResponse = {
  email: string;
  name: string | null;
  role: Role;
  phoneE164: string | null;
  phoneStatus: "none" | "pending" | "approved" | "rejected";
};

const e164Regex = /^\+[1-9]\d{1,14}$/;

export default function ProfilePage() {
  const { status } = useSession();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }

    if (status !== "authenticated") {
      return;
    }

    async function fetchMe() {
      const response = await fetch("/api/me", { cache: "no-store" });

      if (!response.ok) {
        setError("No se pudo cargar el perfil.");
        return;
      }

      const data = (await response.json()) as MeResponse;
      setMe(data);
      setPhoneInput(data.phoneE164 ?? "");
    }

    void fetchMe();
  }, [router, status]);

  async function submitPhone() {
    setError("");

    if (!e164Regex.test(phoneInput)) {
      setError("El teléfono debe estar en formato E.164 (ej: +5491122334455).");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneE164: phoneInput }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? "No se pudo enviar la solicitud.");
        return;
      }

      const data = (await response.json()) as MeResponse;
      setMe(data);
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Cargando sesión...</main>;
  }

  if (!me) {
    return <main className="p-6 text-sm text-slate-600">Cargando perfil...</main>;
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/dashboard" className="inline-block text-sm text-slate-600 hover:text-slate-900">
          ← Volver al dashboard
        </Link>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Mi perfil</h1>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <p>Email: {me.email}</p>
            <p>Nombre: {me.name ?? "-"}</p>
            <p>Rol: {me.role}</p>
            <p>phoneStatus: {me.phoneStatus}</p>
            <p>phoneE164: {me.phoneE164 ?? "-"}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Solicitar aprobación de teléfono</h2>
          <p className="mt-1 text-sm text-slate-600">Ingresa un número en formato E.164.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value.trim())}
              placeholder="+5491122334455"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            />
            <button
              type="button"
              onClick={() => void submitPhone()}
              disabled={loading}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Enviando..." : "Enviar solicitud"}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
