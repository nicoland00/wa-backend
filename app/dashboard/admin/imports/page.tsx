"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canViewAdminScreens } from "@/lib/permissions";

type Ranch = { _id: string; name: string };
type Lot = { _id: string; name: string; ranchId: string };
type Animal = { _id: string; earTagNumber: string; name?: string | null; breed: string; sex: string; currentWeight: number };
type VideoImport = {
  _id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  lotId: string | null;
  animalId: string | null;
  status: string;
  createdAt: string;
  videoUrl: string | null;
};

function VideoCard({
  item,
  animals,
  onAssign,
  onUnassign,
}: {
  item: VideoImport;
  animals: Animal[];
  onAssign: (importId: string, animalId: string) => Promise<void>;
  onUnassign: (importId: string) => Promise<void>;
}) {
  const [playing, setPlaying] = useState(false);
  const [selectedAnimalId, setSelectedAnimalId] = useState(item.animalId ?? "");
  const [saving, setSaving] = useState(false);
  const assignedAnimal = animals.find((a) => a._id === item.animalId);

  async function handleAssign() {
    if (!selectedAnimalId) return;
    setSaving(true);
    await onAssign(item._id, selectedAnimalId);
    setSaving(false);
  }

  async function handleUnassign() {
    setSaving(true);
    await onUnassign(item._id);
    setSelectedAnimalId("");
    setSaving(false);
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:shadow-md">
      {/* Video thumbnail */}
      <div className="relative bg-slate-900" style={{ aspectRatio: "16/9" }}>
        {item.videoUrl ? (
          <>
            <video
              src={item.videoUrl}
              className="h-full w-full object-cover opacity-80"
              preload="metadata"
              muted
              playsInline
              controls={playing}
              onClick={() => setPlaying(true)}
            />
            {!playing && (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/40"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-[#57A28B]">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </button>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-slate-500 text-sm">No preview</div>
        )}
      </div>

      {/* Info + assignment */}
      <div className="p-4 space-y-3">
        <div>
          <p className="truncate text-sm font-semibold text-slate-900">{item.filename}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {item.sizeBytes ? `${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB` : "Unknown size"}
          </p>
        </div>

        {assignedAnimal ? (
          <div className="rounded-xl bg-[#f4f7f5] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#57A28B]">Assigned to</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{assignedAnimal.earTagNumber}</p>
            <p className="text-xs text-slate-500">{assignedAnimal.breed} · {assignedAnimal.sex} · {assignedAnimal.currentWeight} kg</p>
            <button
              type="button"
              onClick={() => void handleUnassign()}
              disabled={saving}
              className="mt-2 text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {saving ? "Removing…" : "Remove assignment"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">Assign to animal</p>
            <select
              value={selectedAnimalId}
              onChange={(e) => setSelectedAnimalId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#57A28B] focus:outline-none focus:ring-2 focus:ring-[#57A28B]/20"
            >
              <option value="">Select animal…</option>
              {animals.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.earTagNumber}{a.name ? ` · ${a.name}` : ""} — {a.breed} {a.sex} {a.currentWeight}kg
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleAssign()}
              disabled={!selectedAnimalId || saving}
              className="w-full rounded-xl bg-[#57A28B] py-2 text-sm font-semibold text-white transition hover:bg-[#4a8a76] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Assigning…" : "Assign video"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function AdminImportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canView = session ? canViewAdminScreens(session.user.role) : false;

  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [imports, setImports] = useState<VideoImport[]>([]);
  const [ranchId, setRanchId] = useState("");
  const [lotId, setLotId] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) return;
    fetch("/api/admin/ranches", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ranches: Ranch[] }) => {
        setRanches(d.ranches);
        setRanchId(d.ranches[0]?._id ?? "");
      });
  }, [canView, status]);

  useEffect(() => {
    if (!ranchId) { setLots([]); setLotId(""); return; }
    fetch(`/api/admin/lots?ranchId=${ranchId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { lots: Lot[] }) => {
        setLots(d.lots);
        setLotId(d.lots[0]?._id ?? "");
      });
  }, [ranchId]);

  useEffect(() => {
    if (!lotId) { setAnimals([]); setImports([]); return; }
    Promise.all([
      fetch(`/api/admin/animals?ranchId=${ranchId}&lotId=${lotId}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/imports?lotId=${lotId}`, { cache: "no-store" }).then((r) => r.json()),
    ]).then(([animalData, importData]: [{ animals: Animal[] }, { imports: VideoImport[] }]) => {
      setAnimals(animalData.animals ?? []);
      setImports((importData.imports ?? []).filter((i) => i.filename.endsWith(".mp4") || i.mimeType?.startsWith("video/")));
    });
  }, [lotId, ranchId]);

  async function refreshImports() {
    if (!lotId) return;
    const res = await fetch(`/api/imports?lotId=${lotId}`, { cache: "no-store" });
    if (!res.ok) return;
    const d = (await res.json()) as { imports: VideoImport[] };
    setImports((d.imports ?? []).filter((i) => i.filename.endsWith(".mp4") || i.mimeType?.startsWith("video/")));
  }

  async function handleUpload(files: FileList) {
    if (!lotId || !files.length) return;
    setUploading(true);

    const fileList = Array.from(files);
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setUploadProgress(`Uploading ${file.name} (${i + 1}/${fileList.length})`);
      setUploadPercent(0);

      const ok = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/admin/imports/upload?lotId=${encodeURIComponent(lotId)}`);
        xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
        xhr.setRequestHeader("x-file-size", String(file.size));
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPercent(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let data: { ok?: boolean; skipped?: boolean; error?: string } = {};
          try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
          if (xhr.status >= 200 && xhr.status < 300) {
            if (data.skipped) skipped++; else uploaded++;
            resolve(true);
          } else {
            setMessage(data.error ?? `Upload failed (${xhr.status}).`);
            resolve(false);
          }
        };
        xhr.onerror = () => { resolve(false); };
        xhr.send(file);
      });

      if (!ok) { failed++; }
    }

    const parts: string[] = [];
    if (uploaded) parts.push(`${uploaded} uploaded`);
    if (skipped) parts.push(`${skipped} skipped (duplicates)`);
    if (failed) parts.push(`${failed} failed`);
    if (parts.length) setMessage(parts.join(", ") + ".");

    await refreshImports();
    setUploading(false);
    setUploadProgress(null);
    setUploadPercent(null);
  }

  async function handleAssign(importId: string, animalId: string) {
    const res = await fetch(`/api/imports/${importId}/assign-animal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ animalId }),
    });
    const data = (await res.json()) as { error?: string };
    setMessage(res.ok ? "Video assigned." : data.error ?? "Failed.");
    if (res.ok) {
      setImports((prev) => prev.map((i) => i._id === importId ? { ...i, animalId } : i));
    }
  }

  async function handleUnassign(importId: string) {
    const res = await fetch(`/api/imports/${importId}/assign-animal`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    setMessage(res.ok ? "Assignment removed." : data.error ?? "Failed.");
    if (res.ok) {
      setImports((prev) => prev.map((i) => i._id === importId ? { ...i, animalId: null } : i));
    }
  }

  const assignedCount = imports.filter((i) => i.animalId).length;

  if (status === "loading") return <main className="flex min-h-screen items-center justify-center bg-[#f4f7f5]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#57A28B] border-t-transparent" /></main>;
  if (!canView) return <main className="p-6 text-sm text-slate-500">Forbidden</main>;

  return (
    <main className="min-h-screen bg-[#f4f7f5] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-800">← Dashboard</Link>
        </div>

        {/* Header */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#57A28B]">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="h-5 w-5">
                <path d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Video Imports</h1>
              <p className="text-xs text-slate-500">Assign videos to animals by selecting a ranch and lot</p>
            </div>
          </div>

          {/* Selectors */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:max-w-[560px]">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">Ranch</span>
              <select
                value={ranchId}
                onChange={(e) => setRanchId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-[#57A28B] focus:outline-none focus:ring-2 focus:ring-[#57A28B]/20"
              >
                <option value="">Select ranch…</option>
                {ranches.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
              </select>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">Lot</span>
              <select
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                disabled={!ranchId}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-[#57A28B] focus:outline-none focus:ring-2 focus:ring-[#57A28B]/20 disabled:opacity-50"
              >
                <option value="">Select lot…</option>
                {lots.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
              </select>
            </label>
          </div>

          {lotId ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-slate-600"><strong className="text-slate-900">{imports.length}</strong> video{imports.length !== 1 ? "s" : ""}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600"><strong className="text-[#57A28B]">{assignedCount}</strong> assigned</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600"><strong className="text-slate-900">{imports.length - assignedCount}</strong> unassigned</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600"><strong className="text-slate-900">{animals.length}</strong> animals</span>
              </div>

              {/* Upload button */}
              <label className={`flex cursor-pointer items-center gap-2 rounded-xl border border-[#57A28B]/40 bg-[#57A28B] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4a8a76] ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                {uploading ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 animate-spin"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                    {uploadProgress ?? "Uploading…"}
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Upload videos
                  </>
                )}
                <input
                  type="file"
                  accept="video/*"
                  multiple
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => { if (e.target.files?.length) void handleUpload(e.target.files); e.target.value = ""; }}
                />
              </label>
            </div>
          ) : null}

          {uploading && uploadPercent !== null ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>{uploadProgress ?? "Uploading…"}</span>
                <span>{uploadPercent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-[#57A28B] transition-all duration-200"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          ) : null}

          {message ? (
            <p className="mt-3 text-sm font-medium text-[#57A28B]">{message}</p>
          ) : null}
        </div>

        {/* Video grid */}
        {!lotId ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
            <p className="text-sm font-medium text-slate-400">Select a ranch and lot to see videos</p>
          </div>
        ) : imports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
            <p className="text-sm font-medium text-slate-400">No videos found for this lot</p>
            <p className="mt-1 text-xs text-slate-400">Run the upload script to add videos</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {imports.map((item) => (
              <VideoCard
                key={item._id}
                item={item}
                animals={animals}
                onAssign={handleAssign}
                onUnassign={handleUnassign}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
