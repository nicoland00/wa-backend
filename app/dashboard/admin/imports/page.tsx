"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canMutateAdminData, canViewAdminScreens } from "@/lib/permissions";

type Ranch = { _id: string; name: string };
type Lot = { _id: string; name: string; ranchId: string };
type Animal = { _id: string; earTagNumber: string; name?: string | null; breed: string; currentWeight: number; lotId?: string };
type VideoImport = {
  _id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  lotId: string | null;
  animalId: string | null;
  createdAt: string;
  videoUrl: string | null;
  weight?: number | null;
  measuredAt?: string | null;
  deltaKg?: number | null;
  previousWeight?: number | null;
};
type Assignment = { animalId: string; weight: number; measuredAt: string };
type Notice = { text: string; error?: boolean };

const inputClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-md bg-[#285447] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1e4036] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass = "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const numberFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function preferredSelection(parameter: string, storageKey: string) {
  try { return new URLSearchParams(window.location.search).get(parameter) || window.localStorage.getItem(storageKey) || ""; }
  catch { return ""; }
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatBytes(bytes: number | null) {
  return bytes ? `${numberFormat.format(bytes / 1024 / 1024)} MB` : "Tamaño no disponible";
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la operación. Inténtalo de nuevo.");
  return data as T;
}

function isVideo(item: VideoImport) {
  return item.mimeType?.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(item.filename);
}

function VideoRow({ item, animals, lots, canEdit, onAssign, onUnassign, onDelete }: {
  item: VideoImport;
  animals: Animal[];
  lots: Lot[];
  canEdit: boolean;
  onAssign: (id: string, assignment: Assignment) => Promise<void>;
  onUnassign: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedAnimalId, setSelectedAnimalId] = useState(item.animalId ?? "");
  const [weight, setWeight] = useState(item.weight?.toString() ?? "");
  const [measuredAt, setMeasuredAt] = useState(item.measuredAt?.slice(0, 10) ?? today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assignedAnimal = animals.find((animal) => animal._id === item.animalId);
  const selectedAnimal = animals.find((animal) => animal._id === selectedAnimalId);
  const animalLabel = assignedAnimal?.earTagNumber || assignedAnimal?.name || (item.animalId ? "Animal asignado" : "Sin asignar");

  async function submitAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericWeight = Number(weight);
    if (!selectedAnimalId || !measuredAt || !Number.isFinite(numericWeight) || numericWeight <= 0) {
      setError("Selecciona un animal e indica un peso mayor que cero y la fecha del pesaje.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAssign(item._id, { animalId: selectedAnimalId, weight: numericWeight, measuredAt });
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el registro.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: "video" | "assignment") {
    setBusy(true);
    setError("");
    try {
      if (kind === "video") await onDelete(item._id);
      else {
        await onUnassign(item._id);
        setSelectedAnimalId("");
        setWeight("");
        setMeasuredAt(today());
      }
      setDeleting(false);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className={`relative shrink-0 overflow-hidden rounded-md bg-slate-900 ${playing ? "w-full sm:w-72" : "w-full sm:w-36"}`}>
          {item.videoUrl ? (
            <>
              <video ref={videoRef} src={item.videoUrl} className="aspect-video w-full object-contain" preload="metadata" muted={!playing} playsInline controls={playing} />
              {!playing ? <button type="button" aria-label={`Reproducir ${item.filename}`} onClick={() => { setPlaying(true); void videoRef.current?.play().catch(() => {}); }} className="absolute inset-0 flex items-center justify-center bg-black/15 text-white hover:bg-black/30">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-black/30"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M8 5v14l11-7z" /></svg></span>
              </button> : null}
            </>
          ) : <div className="flex aspect-video items-center justify-center px-3 text-center text-xs text-slate-400">Vista previa no disponible</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${item.animalId ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{item.animalId ? "Asignado" : "Pendiente de asignar"}</span>
            <span className="text-xs text-slate-500">Subido el {formatDate(item.createdAt)}</span>
          </div>
          <h3 className="mt-2 break-words text-sm font-medium text-slate-900">{item.filename}</h3>
          <p className="mt-1 text-xs text-slate-500">{formatBytes(item.sizeBytes)}</p>
        </div>
        <div className="min-w-36 text-sm">
          <p className="font-medium text-slate-800">{animalLabel}</p>
          {item.animalId ? <p className="mt-1 text-xs text-slate-500">{assignedAnimal?.name || assignedAnimal?.breed || ""}</p> : <p className="mt-1 text-xs text-slate-500">Selecciona un animal de cualquier lote</p>}
          {item.weight != null ? (
            <div className="mt-2">
              <p className="font-medium tabular-nums text-slate-800">{numberFormat.format(item.weight)} kg <span className="text-xs font-normal text-slate-500">· {formatDate(item.measuredAt)}</span></p>
              {item.deltaKg != null ? <p className={`mt-1 text-xs ${item.deltaKg < 0 ? "text-amber-800" : "text-emerald-800"}`}>{item.deltaKg > 0 ? "+" : ""}{numberFormat.format(item.deltaKg)} kg respecto al pesaje anterior</p> : <p className="mt-1 text-xs text-slate-500">Primer pesaje registrado</p>}
            </div>
          ) : item.animalId ? <p className="mt-2 text-xs text-amber-800">Vídeo anterior sin pesaje vinculado</p> : null}
        </div>
        {canEdit ? <div className="flex gap-2 sm:flex-col sm:items-stretch">
          <button type="button" disabled={busy} onClick={() => { setEditing(!editing); setDeleting(false); setError(""); }} aria-expanded={editing} className={item.animalId ? secondaryClass : buttonClass}>{editing ? "Cerrar" : item.animalId ? "Añadir a otro animal" : "Asignar y pesar"}</button>
          <button type="button" disabled={busy} onClick={() => { setDeleting(!deleting); setEditing(false); setError(""); }} aria-expanded={deleting} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">Eliminar vídeo</button>
        </div> : null}
      </div>
      {editing ? <form onSubmit={(event) => void submitAssignment(event)} className="border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5">
        <p className="text-sm font-medium text-slate-800">{item.animalId ? "Añadir este vídeo y peso a otro animal" : "Registrar vídeo y pesaje"}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">La fecha debe corresponder al día del pesaje. Se comparará con el registro anterior del animal.{item.animalId ? " El registro original se conserva en el otro animal, aunque pertenezca a otro lote." : ""}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">Animal
            <select value={selectedAnimalId} onChange={(event) => setSelectedAnimalId(event.target.value)} required disabled={busy} className={inputClass}>
              <option value="">Selecciona un animal</option>
              {animals.map((animal) => <option key={animal._id} value={animal._id}>{animal.earTagNumber || animal.name || animal._id}{animal.name && animal.earTagNumber ? ` · ${animal.name}` : ""}{animal.breed ? ` · ${animal.breed}` : ""} · {lots.find((lot) => lot._id === animal.lotId)?.name ?? "Sin lote"}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">Peso del pesaje (kg)
            <input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Ej. 500" value={weight} onChange={(event) => setWeight(event.target.value)} required readOnly={item.weight != null} disabled={busy} className={inputClass} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">Fecha del pesaje
            <input type="date" value={measuredAt} onChange={(event) => setMeasuredAt(event.target.value)} required readOnly={item.weight != null} disabled={busy} className={inputClass} />
          </label>
        </div>
        {selectedAnimal ? <p className="mt-3 text-xs text-slate-500">Último peso registrado del animal: <strong className="font-medium text-slate-700">{numberFormat.format(selectedAnimal.currentWeight)} kg</strong>. La comparación se calculará según la fecha que indiques.</p> : null}
        {!animals.length ? <p className="mt-3 text-xs text-amber-800">Este lote todavía no tiene animales. Añade un animal antes de asignar el vídeo.</p> : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {item.animalId ? <button type="button" onClick={() => void remove("assignment")} disabled={busy} className="text-xs text-slate-500 underline underline-offset-4 hover:text-slate-800 disabled:opacity-50">Desvincular vídeo · conservar pesaje</button> : <span className="text-xs text-slate-500">Los tres campos son obligatorios.</span>}
          <div className="flex gap-2"><button type="button" onClick={() => setEditing(false)} disabled={busy} className={secondaryClass}>Cancelar</button><button type="submit" disabled={busy || !animals.length} className={buttonClass}>{busy ? "Guardando…" : "Guardar registro"}</button></div>
        </div>
      </form> : null}
      {deleting ? <div className="border-t border-red-100 bg-red-50/50 p-4" role="group" aria-label={`Confirmar eliminación de ${item.filename}`}>
        <p className="text-sm font-medium text-slate-900">Eliminar «{item.filename}»</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">El vídeo dejará de aparecer en la biblioteca y en el animal. Los pesajes registrados se conservarán. Esta acción no se puede deshacer.</p>
        <div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => setDeleting(false)} className={secondaryClass}>Cancelar</button><button type="button" disabled={busy} onClick={() => void remove("video")} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">{busy ? "Eliminando…" : "Sí, eliminar vídeo"}</button></div>
      </div> : null}
      {error ? <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
    </article>
  );
}

export default function AdminImportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canView = session ? canViewAdminScreens(session.user.role) : false;
  const canEdit = session ? canMutateAdminData(session.user.role) : false;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [imports, setImports] = useState<VideoImport[]>([]);
  const [ranchId, setRanchId] = useState("");
  const [lotId, setLotId] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLots, setLoadingLots] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadWeight, setUploadWeight] = useState("");
  const [uploadDate, setUploadDate] = useState(today);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "assigned">("all");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) return;
    const controller = new AbortController();
    void readJson<{ ranches: Ranch[] }>("/api/admin/ranches", { signal: controller.signal }).then((data) => {
      setRanches(data.ranches);
      const preferred = preferredSelection("ranchId", "pastora.dashboard.selectedRanchId");
      setRanchId(data.ranches.some((ranch) => ranch._id === preferred) ? preferred : data.ranches[0]?._id ?? "");
    }).catch((cause) => { if (!controller.signal.aborted) setNotice({ text: cause.message, error: true }); });
    return () => controller.abort();
  }, [canView, status]);

  useEffect(() => {
    setLots([]);
    setLotId("");
    setAnimals([]);
    setImports([]);
    if (!ranchId) return;
    const controller = new AbortController();
    setLoadingLots(true);
    void readJson<{ lots: Lot[] }>(`/api/admin/lots?ranchId=${ranchId}`, { signal: controller.signal }).then((data) => {
      setLots(data.lots);
      const preferred = preferredSelection("lotId", `pastora.dashboard.selectedLotId:${ranchId}`);
      setLotId(data.lots.some((lot) => lot._id === preferred) ? preferred : data.lots[0]?._id ?? "");
    }).catch((cause) => { if (!controller.signal.aborted) setNotice({ text: cause.message, error: true }); }).finally(() => { if (!controller.signal.aborted) setLoadingLots(false); });
    return () => controller.abort();
  }, [ranchId]);

  useEffect(() => {
    setQueuedFiles([]);
    setAnimals([]);
    setImports([]);
    setFilter("all");
    setSearch("");
  }, [lotId]);

  useEffect(() => {
    if (!lotId || !ranchId) return;
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      readJson<{ animals: Animal[] }>(`/api/admin/animals?ranchId=${ranchId}`, { signal: controller.signal }),
      readJson<{ imports: VideoImport[] }>(`/api/imports?ranchId=${ranchId}`, { signal: controller.signal }),
    ]).then(([animalData, importData]) => {
      setAnimals(animalData.animals ?? []);
      setImports((importData.imports ?? []).filter(isVideo));
    }).catch((cause) => { if (!controller.signal.aborted) setNotice({ text: cause.message, error: true }); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [lotId, ranchId, refreshKey]);

  function queueFiles(files: File[]) {
    const valid = files.filter((file) => file.size > 0 && (file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(file.name)));
    if (valid.length !== files.length) setNotice({ text: "Solo se admiten archivos de vídeo que no estén vacíos.", error: true });
    else setNotice(null);
    setQueuedFiles(valid.slice(0, 1));
  }

  async function uploadOneFile(file: File): Promise<"uploaded" | "skipped"> {
    const chunkSize = 800 * 1024;
    const uploadId = crypto.randomUUID().replaceAll("-", "");
    const total = Math.max(1, Math.ceil(file.size / chunkSize));
    for (let index = 0; index < total; index++) {
      const start = index * chunkSize;
      const blob = file.slice(start, Math.min(start + chunkSize, file.size));
      const result = await new Promise<{ status: number; completed?: boolean; skipped?: boolean; error?: string; ok?: boolean }>((resolve) => {
        const xhr = new XMLHttpRequest();
        const query = new URLSearchParams({ uploadId, lotId, index: String(index), total: String(total), weight: uploadWeight, measuredAt: uploadDate });
        xhr.open("POST", `/api/admin/imports/upload-chunk?${query}`);
        xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
        xhr.setRequestHeader("x-file-type", file.type || "video/mp4");
        xhr.setRequestHeader("x-file-size", String(file.size));
        xhr.timeout = 120000;
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadPercent(Math.min(100, Math.round(((start + event.loaded) / file.size) * 100))); };
        xhr.onload = () => { let data = {}; try { data = JSON.parse(xhr.responseText); } catch {} resolve({ ...data, status: xhr.status }); };
        xhr.onerror = () => resolve({ status: 0, error: "Se ha interrumpido la conexión." });
        xhr.ontimeout = () => resolve({ status: 0, error: "La subida ha tardado demasiado. Vuelve a intentarlo." });
        xhr.send(blob);
      });
      if (result.status < 200 || result.status >= 300 || result.ok === false) throw new Error(result.error ?? `No se pudo subir ${file.name}.`);
      if (result.completed) { setUploadPercent(100); return result.skipped ? "skipped" : "uploaded"; }
    }
    throw new Error(`No se ha confirmado la subida de ${file.name}. Vuelve a intentarlo.`);
  }

  async function handleUpload() {
    if (!lotId || !queuedFiles.length || uploading) return;
    if (!(Number(uploadWeight) > 0) || !uploadDate) { setNotice({ text: "Indica el peso y la fecha que acompañan al vídeo.", error: true }); return; }
    setUploading(true);
    setNotice(null);
    let uploaded = 0;
    let skipped = 0;
    const failed: File[] = [];
    const failures: string[] = [];
    try {
      for (const [index, file] of queuedFiles.entries()) {
        setUploadProgress(`${index + 1} de ${queuedFiles.length} · ${file.name}`);
        setUploadPercent(0);
        try {
          const result = await uploadOneFile(file);
          if (result === "uploaded") uploaded++; else skipped++;
        } catch (cause) { failed.push(file); failures.push(cause instanceof Error ? cause.message : "Error de subida."); }
      }
      setQueuedFiles(failed);
      setRefreshKey((key) => key + 1);
      const parts = [];
      if (uploaded) parts.push(`${uploaded} vídeo${uploaded === 1 ? "" : "s"} subido${uploaded === 1 ? "" : "s"}`);
      if (skipped) parts.push(`${skipped} duplicado${skipped === 1 ? "" : "s"} omitido${skipped === 1 ? "" : "s"}`);
      if (failed.length) parts.push(`${failed.length} pendiente${failed.length === 1 ? "" : "s"} de reintentar`);
      setNotice({ text: `${parts.join(" · ")}.${uploaded ? " Asigna cada vídeo a su animal y registra el pesaje." : ""}${failures.length ? ` ${failures[0]}` : ""}`, error: failed.length > 0 });
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  async function handleAssign(id: string, assignment: Assignment) {
    await readJson(`/api/imports/${id}/assign-animal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(assignment) });
    setNotice({ text: "Vídeo y pesaje guardados. El historial y el peso del animal se han actualizado." });
    setRefreshKey((key) => key + 1);
  }

  async function handleUnassign(id: string) {
    await readJson(`/api/imports/${id}/assign-animal`, { method: "DELETE" });
    setNotice({ text: "Vídeo desvinculado. El pesaje se conserva en el historial del animal." });
    setRefreshKey((key) => key + 1);
  }

  async function handleDelete(id: string) {
    await readJson(`/api/imports/${id}`, { method: "DELETE" });
    setImports((current) => current.filter((item) => item._id !== id));
    setNotice({ text: "Vídeo eliminado. Los pesajes registrados se han conservado." });
  }

  const assignedCount = imports.filter((item) => item.animalId).length;
  const visibleImports = imports.filter((item) => {
    if (filter === "pending" && item.animalId) return false;
    if (filter === "assigned" && !item.animalId) return false;
    const animal = animals.find((entry) => entry._id === item.animalId);
    return `${item.filename} ${item.weight ?? ""} ${item.measuredAt ?? ""} ${animal?.earTagNumber ?? ""} ${animal?.name ?? ""} ${lots.find((lot) => lot._id === animal?.lotId)?.name ?? ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"));
  });

  if (status === "loading") return <div className="p-8 text-sm text-slate-500" role="status">Cargando biblioteca…</div>;
  if (!canView) return <div className="p-8 text-sm text-slate-500">No tienes acceso a esta sección.</div>;

  return (
    <main className="mx-auto max-w-6xl space-y-7 p-4 sm:p-6 lg:p-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Seguimiento del ganado</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vídeos y pesajes</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Cada vídeo, unido a su animal y a un pesaje. Un historial claro para seguir su evolución.</p></div>
          <span className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">{canEdit ? "Administración" : "Solo consulta"}</span>
        </div>
      </header>

      <section aria-label="Seleccionar explotación y lote" className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr]">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">Explotación
            <select value={ranchId} onChange={(event) => { setRanchId(event.target.value); setNotice(null); }} disabled={uploading} className={inputClass}><option value="">Selecciona una explotación</option>{ranches.map((ranch) => <option key={ranch._id} value={ranch._id}>{ranch.name}</option>)}</select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">Lote
            <select value={lotId} onChange={(event) => { setLotId(event.target.value); setNotice(null); }} disabled={!ranchId || uploading || loadingLots} className={inputClass}><option value="">{loadingLots ? "Cargando lotes…" : "Selecciona un lote"}</option>{lots.map((lot) => <option key={lot._id} value={lot._id}>{lot.name}</option>)}</select>
          </label>
          <div className="flex items-end gap-5 border-t border-slate-100 pt-3 sm:col-span-2 lg:col-span-1 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div><p className="text-xl font-semibold tabular-nums text-slate-800">{loading ? "—" : imports.length}</p><p className="mt-0.5 text-xs text-slate-500">Vídeos</p></div>
            <div><p className="text-xl font-semibold tabular-nums text-slate-800">{loading ? "—" : imports.length - assignedCount}</p><p className="mt-0.5 text-xs text-slate-500">Sin asignar</p></div>
            <div><p className="text-xl font-semibold tabular-nums text-slate-800">{loading ? "—" : animals.length}</p><p className="mt-0.5 text-xs text-slate-500">Animales</p></div>
          </div>
        </div>
      </section>

      {notice ? <div role={notice.error ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm leading-6 ${notice.error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><p>{notice.text}</p><button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="shrink-0 px-1 font-medium">×</button></div> : null}

      {canEdit && lotId ? <section aria-labelledby="upload-heading" className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-xs font-medium text-slate-500">1</span><div><h2 id="upload-heading" className="text-sm font-semibold text-slate-800">Subir vídeos al lote</h2><p className="mt-1 text-xs text-slate-500">Guarda vídeo, peso y fecha juntos. Después podrás asignar el registro a animales de cualquier lote de esta finca.</p></div></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">Peso del vídeo (kg) *<input type="number" min="0.01" step="any" required value={uploadWeight} disabled={uploading} onChange={(event) => setUploadWeight(event.target.value)} className={inputClass} placeholder="Ej. 500" /></label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">Fecha del pesaje *<input type="date" required value={uploadDate} disabled={uploading} onChange={(event) => setUploadDate(event.target.value)} className={inputClass} /></label>
        </div>
        <div onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploading) queueFiles(Array.from(event.dataTransfer.files)); }} className={`mt-4 flex flex-col items-center justify-between gap-4 rounded-md border border-dashed px-5 py-6 sm:flex-row ${dragging ? "border-emerald-700 bg-emerald-50" : "border-slate-300 bg-slate-50/50"}`}>
          <div className="flex items-center gap-3"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 shrink-0 text-slate-400"><path d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg><div><p className="text-sm text-slate-700">Arrastra tus vídeos aquí</p><p className="mt-1 text-xs text-slate-500">Selecciona un vídeo por pesaje. Vídeo, peso y fecha se guardan juntos.</p></div></div>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className={secondaryClass}>Seleccionar archivos</button>
          <input ref={fileInputRef} type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.avi,.mkv" className="sr-only" tabIndex={-1} aria-label="Seleccionar vídeos" disabled={uploading} onChange={(event) => { queueFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        </div>
        {queuedFiles.length ? <div className="mt-3">
          <ul className="max-h-44 divide-y divide-slate-100 overflow-auto">{queuedFiles.map((file, index) => <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0 truncate text-slate-600">{file.name} <span className="text-slate-400">· {formatBytes(file.size)}</span></span><button type="button" disabled={uploading} aria-label={`Quitar ${file.name} de la selección`} onClick={() => setQueuedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} className="shrink-0 rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40">Quitar</button></li>)}</ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">{queuedFiles.length} archivo{queuedFiles.length === 1 ? "" : "s"} · {formatBytes(queuedFiles.reduce((sum, file) => sum + file.size, 0))}</p><button type="button" disabled={uploading} onClick={() => void handleUpload()} className={buttonClass}>{uploading ? "Subiendo…" : `Subir ${queuedFiles.length === 1 ? "vídeo" : `${queuedFiles.length} vídeos`}`}</button></div>
        </div> : null}
        {uploading ? <div className="mt-4" role="status"><div className="mb-2 flex justify-between gap-3 text-xs text-slate-500"><span className="truncate">{uploadProgress}</span><span className="tabular-nums">{uploadPercent}%</span></div><progress value={uploadPercent} max={100} aria-label="Progreso del archivo actual" className="h-1.5 w-full accent-[#285447]" /><p className="mt-2 text-xs text-slate-500">Mantén esta página abierta hasta que termine la subida.</p></div> : null}
      </section> : null}

      <section aria-labelledby="library-heading">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3">{canEdit ? <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-xs font-medium text-slate-500">2</span> : null}<div><h2 id="library-heading" className="text-sm font-semibold text-slate-800">Galería de vídeos y pesos · todos los lotes</h2><p className="mt-1 text-xs text-slate-500">{canEdit ? "Asigna cada vídeo y registra el pesaje del animal." : "Consulta los vídeos y los pesajes de los animales."}</p></div></div><input type="search" aria-label="Buscar vídeos por nombre o animal" placeholder="Buscar vídeo, peso, animal o lote…" value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} sm:max-w-64`} disabled={!lotId} /></div>
        <div className="my-4 flex gap-1 border-b border-slate-200" aria-label="Filtrar vídeos">{([{ value: "all", label: "Todos", count: imports.length }, { value: "pending", label: "Sin asignar", count: imports.length - assignedCount }, { value: "assigned", label: "Asignados", count: assignedCount }] as const).map((option) => <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className={`border-b-2 px-3 py-2.5 text-xs font-medium transition ${filter === option.value ? "border-[#285447] text-[#285447]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{option.label} <span className="ml-1 text-slate-400">{option.count}</span></button>)}</div>
        {loading || loadingLots ? <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500" role="status">Cargando vídeos y animales…</div> : !lotId ? <div className="rounded-lg border border-slate-200 bg-white p-10 text-center"><p className="text-sm font-medium text-slate-700">Selecciona una explotación y un lote</p><p className="mt-2 text-xs text-slate-500">Aquí verás sus vídeos y podrás seguir la evolución de cada animal.</p></div> : !visibleImports.length ? <div className="rounded-lg border border-slate-200 bg-white p-10 text-center"><p className="text-sm font-medium text-slate-700">{imports.length ? "No hay vídeos que coincidan" : "Este lote aún no tiene vídeos"}</p><p className="mt-2 text-xs text-slate-500">{imports.length ? "Prueba otra búsqueda o cambia el filtro." : canEdit ? "Selecciona archivos en el área de subida para empezar." : "Los vídeos aparecerán aquí cuando se registren."}</p></div> : <div className="space-y-3">{visibleImports.map((item) => <VideoRow key={`${item._id}-${item.animalId}-${item.weight}-${item.measuredAt}`} item={item} animals={animals} lots={lots} canEdit={canEdit && !uploading} onAssign={handleAssign} onUnassign={handleUnassign} onDelete={handleDelete} />)}</div>}
      </section>
    </main>
  );
}
