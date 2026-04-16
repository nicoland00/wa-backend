"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canMutateAdminData, canViewAdminScreens } from "@/lib/permissions";

type CredentialStatus = {
  source: "database" | "environment" | "missing";
  hasDatabaseCredential: boolean;
  hasEnvironmentCredential: boolean;
  maskedRefreshToken: string | null;
  clientId: string | null;
  tokenUrl: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  lastRefreshAttemptAt: string | null;
  lastRefreshSucceededAt: string | null;
  lastRefreshError: string | null;
};

export default function AdminIxoriguePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

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

    async function loadStatus() {
      const response = await fetch("/api/admin/ixorigue/credentials", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      setCredentialStatus((await response.json()) as CredentialStatus);
    }

    void loadStatus();
  }, [canView, status]);

  async function saveCredential() {
    setBusy("save");
    setMessage("");

    const response = await fetch("/api/admin/ixorigue/credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken,
        clientId: clientId || undefined,
        tokenUrl: tokenUrl || undefined,
      }),
    });

    const data = (await response.json()) as CredentialStatus & { error?: string };
    setMessage(response.ok ? "Ixorigue credential saved." : data.error ?? "Failed to save Ixorigue credential.");
    if (response.ok) {
      setCredentialStatus(data);
      setRefreshToken("");
      setClientId("");
      setTokenUrl("");
    }

    setBusy(null);
  }

  async function testCredential() {
    setBusy("test");
    setMessage("");

    const response = await fetch("/api/admin/ixorigue/credentials/test", {
      method: "POST",
    });

    const data = (await response.json()) as { error?: string; ranchCount?: number; firstRanchName?: string | null; status?: CredentialStatus };
    setMessage(
      response.ok
        ? `Ixorigue test succeeded. Ranches returned: ${data.ranchCount ?? 0}${data.firstRanchName ? ` · First ranch: ${data.firstRanchName}` : ""}.`
        : data.error ?? "Ixorigue test failed.",
    );
    if (response.ok && data.status) {
      setCredentialStatus(data.status);
    }

    setBusy(null);
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  }
  if (!canView) {
    return <main className="p-6 text-sm text-slate-600">Forbidden</main>;
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Ixorigue Credential Admin</h1>
          <p className="mt-1 text-sm text-slate-600">
            Store and test the Ixorigue refresh token without editing deployment environment variables every time it rotates.
          </p>
          {!canManage ? (
            <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Institutional users can review credential health here, but only admins can save or test credentials.
            </p>
          ) : null}
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Current status</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-700">
              <p><span className="font-medium">Active source:</span> {credentialStatus?.source ?? "loading"}</p>
              <p><span className="font-medium">Stored token:</span> {credentialStatus?.maskedRefreshToken ?? "none"}</p>
              <p><span className="font-medium">Client ID:</span> {credentialStatus?.clientId ?? "unknown"}</p>
              <p><span className="font-medium">Token URL:</span> {credentialStatus?.tokenUrl ?? "unknown"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-700">
              <p><span className="font-medium">Updated:</span> {credentialStatus?.updatedAt ? new Date(credentialStatus.updatedAt).toLocaleString() : "never"}</p>
              <p><span className="font-medium">Last refresh attempt:</span> {credentialStatus?.lastRefreshAttemptAt ? new Date(credentialStatus.lastRefreshAttemptAt).toLocaleString() : "never"}</p>
              <p><span className="font-medium">Last refresh success:</span> {credentialStatus?.lastRefreshSucceededAt ? new Date(credentialStatus.lastRefreshSucceededAt).toLocaleString() : "never"}</p>
              <p><span className="font-medium">Last refresh error:</span> {credentialStatus?.lastRefreshError ?? "none"}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Update refresh token</h2>
          <p className="mt-1 text-sm text-slate-600">
            The token is stored encrypted in MongoDB. Leave client ID or token URL blank to infer them from the refresh token and environment defaults.
          </p>

          <div className="mt-4 grid gap-3">
            <textarea
              value={refreshToken}
              onChange={(event) => setRefreshToken(event.target.value)}
              placeholder="Paste the Ixorigue refresh token"
              disabled={!canManage}
              className="min-h-32 rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Optional client ID override"
                disabled={!canManage}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
              />
              <input
                value={tokenUrl}
                onChange={(event) => setTokenUrl(event.target.value)}
                placeholder="Optional token URL override"
                disabled={!canManage}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveCredential()}
                disabled={!canManage || !refreshToken.trim() || busy !== null}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {busy === "save" ? "Saving..." : "Save refresh token"}
              </button>
              <button
                type="button"
                onClick={() => void testCredential()}
                disabled={!canManage || busy !== null}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                {busy === "test" ? "Testing..." : "Test credential"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

