"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canMutateAdminData, canViewAdminScreens } from "@/lib/permissions";
import AnimalWeightHistory from "@/components/AnimalWeightHistory";
import type { AnimalHistoryVideo } from "@/components/AnimalWeightHistory";

type Ranch = { _id: string; name: string; };
type Lot = { _id: string; ranchId: string; name: string; };
type Weight = { _id: string; weight: number; measuredAt: string; deltaKg: number | null; previousWeight: number | null; previousMeasuredAt: string | null; importId?: string | null; };
type Animal = {
  _id: string; lotId: string; earTagNumber: string; breed: string; sex: string;
  specie?: string | null; name?: string | null; currentWeight: number;
  syncStatus: "pending" | "synced" | "failed"; syncError: string | null;
  ixorigueAnimalId?: string | null; brandNumber?: string; color?: string; initialWeight?: number;
  weightHistory?: Weight[]; latestWeight?: Weight | null; weightChangeKg?: number | null; videos?: AnimalHistoryVideo[];
};
type VideoImport = { weight?: number | null; measuredAt?: string | null; _id: string; filename: string; sizeBytes: number | null; animalId: string | null; videoUrl?: string | null; mimeType?: string | null; };
type Option = { value: string; label: string; };
type MetadataResponse = { specieOptions: Option[]; sexOptions: Option[]; breedOptionsBySpecie: Record<string, string[]>; earTagOptions: string[]; deviceOptions: { value: string; label: string; disabled: boolean; assignedAnimalLabel: string | null; }[]; remoteError: string | null; };
const emptyMetadata: MetadataResponse = { specieOptions: [], sexOptions: [], breedOptionsBySpecie: {}, earTagOptions: [], deviceOptions: [], remoteError: null };
const field = "min-w-0 w-full rounded-md border border-[#d8dfd8] bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#3f7561] focus:ring-2 focus:ring-[#3f7561]/15 disabled:bg-slate-50";
const secondary = "inline-flex items-center justify-center rounded-md border border-[#d8dfd8] bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-[#f6f7f4] disabled:opacity-50";
const primary = "inline-flex items-center justify-center rounded-md bg-[#31574b] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#254538] disabled:cursor-not-allowed disabled:opacity-50";
const species: Record<string, string> = { cow: "Bovino", sheep: "Ovino", goat: "Caprino", pig: "Porcino", horse: "Equino", donkey: "Asno" };
const sexes: Record<string, string> = { female: "Hembra", male: "Macho", steer: "Novillo" };
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function dateLabel(value?: string | null) { if (!value) return "Sin fecha registrada"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Sin fecha registrada" : date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
function kilos(value: number) { return value.toLocaleString("es-ES", { maximumFractionDigits: 2 }); }
function delta(value?: number | null) { return value == null ? "Primer registro" : `${value > 0 ? "+" : ""}${kilos(value)} kg`; }
async function readJson<T>(response: Response): Promise<T> { return response.json().catch(() => ({})) as Promise<T>; }
function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? []);
    (panel?.querySelector<HTMLElement>("input, select") ?? focusable()[0] ?? panel)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const items = focusable(); const first = items[0]; const last = items[items.length - 1];
      if (!first) { event.preventDefault(); panel?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/45 p-4" onClick={() => { if (!busy) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="my-auto max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-lg border border-[#e1e5e1] bg-white p-5 shadow-xl sm:p-6" onClick={(event) => event.stopPropagation()}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}
        </h2>
        <button type="button" disabled={busy} aria-label="Cerrar ventana" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#31574b]">✕</button>
      </div>{children}
    </div>
  </div>;
}

export default function AdminAnimalsPage() {
  const { data: session, status } = useSession(); const router = useRouter();
  const [ranches, setRanches] = useState<Ranch[]>([]); const [lots, setLots] = useState<Lot[]>([]); const [animals, setAnimals] = useState<Animal[]>([]);
  const [metadata, setMetadata] = useState<MetadataResponse>(emptyMetadata); const [ranchId, setRanchId] = useState(""); const [lotId, setLotId] = useState("");
  const [notice, setNotice] = useState<{ text: string; error: boolean; } | null>(null); const [loading, setLoading] = useState(true); const [syncing, setSyncing] = useState(false); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""); const [showCreate, setShowCreate] = useState(false); const [historyAnimal, setHistoryAnimal] = useState<Animal | null>(null);
  const [weightModal, setWeightModal] = useState<Animal | null>(null); const [weightInput, setWeightInput] = useState(""); const [measurementDate, setMeasurementDate] = useState(today);
  const [videoQuery, setVideoQuery] = useState("");
  const [videoImports, setVideoImports] = useState<VideoImport[]>([]); const [videoAssignModal, setVideoAssignModal] = useState<Animal | null>(null); const [selectedVideoId, setSelectedVideoId] = useState(""); const [videosLoading, setVideosLoading] = useState(false);
  const videoRequestId = useRef(0);
  const [deleteModal, setDeleteModal] = useState<Animal | null>(null); const [modalError, setModalError] = useState("");
  const canView = session ? canViewAdminScreens(session.user.role) : false; const canManage = session ? canMutateAdminData(session.user.role) : false;
  const [form, setForm] = useState({ specie: "cow", breed: "", name: "", sex: "female", color: "", brandNumber: "", earTagNumber: "", deviceId: "", initialWeight: "", measuredAt: today(), dateType: "birth" as "birth" | "purchase", dateValue: "", photo: null as File | null, video: null as File | null });
  function notify(text: string, error = false) { setNotice({ text, error }); }
  useEffect(() => { if (status === "unauthenticated") router.replace("/login"); }, [router, status]);
  useEffect(() => {
    if (status !== "authenticated" || !canView) return;
    let active = true;
    void fetch("/api/admin/ranches", { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("No se pudieron cargar las fincas."); const data = await response.json() as { ranches: Ranch[]; }; if (!active) return; setRanches(data.ranches); const requested = new URLSearchParams(window.location.search).get("ranchId"); setRanchId((current) => current || (data.ranches.some((r) => r._id === requested) ? requested! : data.ranches[0]?._id || "")); if (!data.ranches.length) setLoading(false); }).catch((error: Error) => { if (active) { notify(error.message, true); setLoading(false); } });
    return () => { active = false; };
  }, [canView, status]);
  useEffect(() => {
    if (!ranchId) return;
    let active = true;
    void fetch(`/api/admin/lots?ranchId=${ranchId}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("No se pudieron cargar los lotes."); const data = await response.json() as { lots: Lot[]; }; if (!active) return; setLots(data.lots); const requested = new URLSearchParams(window.location.search).get("lotId"); setLotId((current) => data.lots.some((lot) => lot._id === current) ? current : data.lots.some((lot) => lot._id === requested) ? requested! : ""); }).catch((error: Error) => { if (active) notify(error.message, true); });
    return () => { active = false; };
  }, [ranchId]);
  useEffect(() => {
    if (!ranchId) return;
    let active = true;
    setLoading(true);
    void fetch(`/api/admin/animals?ranchId=${ranchId}${lotId ? `&lotId=${lotId}` : ""}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("No se pudieron cargar los animales."); const data = await response.json() as { animals: Animal[]; }; if (active) setAnimals(data.animals); }).catch((error: Error) => { if (active) notify(error.message, true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [lotId, ranchId]);
  useEffect(() => {
    if (!ranchId) return;
    let active = true;
    void fetch(`/api/admin/animals/metadata?ranchId=${ranchId}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) return; const data = await response.json() as MetadataResponse; if (active) setMetadata(data); }).catch(() => { if (active) setMetadata(emptyMetadata); });
    return () => { active = false; };
  }, [ranchId]);
  async function refreshAnimals() {
    const response = await fetch(`/api/admin/animals?ranchId=${ranchId}${lotId ? `&lotId=${lotId}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo actualizar la lista de animales.");
    const data = await response.json() as { animals: Animal[]; }; setAnimals(data.animals);
  }
  async function createAnimal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    if (!lotId) { notify("Selecciona el lote del nuevo animal.", true); return; }
    if ((form.video || form.initialWeight) && (!form.video || !(Number(form.initialWeight) > 0))) { notify("Para añadir un vídeo, registra también el peso y la fecha del pesaje.", true); return; }
    setBusy(true); setNotice(null);
    try {
      const payload = new FormData(); payload.set("lotId", lotId);
      for (const key of ["specie", "name", "sex", "earTagNumber", "breed", "color", "brandNumber", "deviceId", "initialWeight"] as const) { if (form[key]) payload.set(key, form[key]); }
      if (form.initialWeight) payload.set("measuredAt", form.measuredAt);
      payload.set(form.dateType === "birth" ? "birthDate" : "dateOfPurchase", form.dateValue);
      if (form.photo) payload.set("photo", form.photo); if (form.video) payload.set("video", form.video);
      const response = await fetch("/api/admin/animals", { method: "POST", body: payload }); const data = await readJson<{ error?: string; animal?: Animal; }>(response);
      if (response.ok || data.animal) {
        await refreshAnimals(); setShowCreate(false);
        setForm((current) => ({ ...current, breed: "", name: "", color: "", brandNumber: "", earTagNumber: "", deviceId: "", initialWeight: "", dateValue: "", photo: null, video: null }));
      }
      notify(response.ok ? "Animal creado y disponible en el seguimiento." : data.error ?? "No se pudo crear el animal.", !response.ok);
    } catch { notify("No se pudo completar la solicitud. Comprueba la lista antes de volver a crear el animal.", true); } finally { setBusy(false); }
  }
  async function syncRemoteAnimals() {
    if (!ranchId || syncing) return; setSyncing(true);
    try { const response = await fetch(`/api/admin/ranches/${ranchId}/sync-animals`, { method: "POST" }); const data = await readJson<{ error?: string; }>(response); if (!response.ok) throw new Error(data.error ?? "No se pudo sincronizar."); await refreshAnimals(); notify("Animales actualizados."); } catch (error) { notify(error instanceof Error ? error.message : "Error de conexión al sincronizar.", true); } finally { setSyncing(false); }
  }
  async function retrySync(animalId: string) {
    if (busy) return; setBusy(true);
    try { const response = await fetch(`/api/admin/animals/${animalId}/retry-sync`, { method: "POST" }); const data = await readJson<{ error?: string; }>(response); if (!response.ok) throw new Error(data.error ?? "No se pudo reintentar."); await refreshAnimals(); notify("Sincronización reintentada."); } catch (error) { notify(error instanceof Error ? error.message : "Error de conexión.", true); } finally { setBusy(false); }
  }
  async function deleteAnimal() {
    if (!deleteModal || busy) return; setBusy(true); setModalError("");
    try { const response = await fetch(`/api/admin/animals/${deleteModal._id}`, { method: "DELETE" }); const data = await readJson<{ error?: string; }>(response); if (!response.ok) throw new Error(data.error ?? "No se pudo eliminar el animal."); setAnimals((current) => current.filter((animal) => animal._id !== deleteModal._id)); setDeleteModal(null); notify("Animal eliminado."); } catch (error) { setModalError(error instanceof Error ? error.message : "Error de conexión."); } finally { setBusy(false); }
  }
  async function openVideoModal(animal: Animal) {
    const requestId = ++videoRequestId.current;
    setVideoQuery(""); setVideoAssignModal(animal); setSelectedVideoId(""); setWeightInput(""); setMeasurementDate(today()); setModalError(""); setVideoImports([]); setVideosLoading(true);
    try { const response = await fetch(`/api/imports?ranchId=${ranchId}`, { cache: "no-store" }); if (!response.ok) throw new Error("No se pudieron cargar los vídeos del lote."); const data = await response.json() as { imports: VideoImport[]; }; if (requestId !== videoRequestId.current) return; setVideoImports(data.imports.filter((item) => item.mimeType?.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(item.filename))); } catch (error) { if (requestId === videoRequestId.current) setModalError(error instanceof Error ? error.message : "Error de conexión."); } finally { if (requestId === videoRequestId.current) setVideosLoading(false); }
  }
  async function submitMeasurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const animal = videoAssignModal ?? weightModal; if (!animal || busy) return;
    const weight = Number(weightInput); if (!Number.isFinite(weight) || weight <= 0 || !measurementDate) { setModalError("Introduce un peso mayor que cero y la fecha del pesaje."); return; }
    if (videoAssignModal && !selectedVideoId) { setModalError("Selecciona un vídeo para continuar."); return; }
    setBusy(true); setModalError("");
    try {
      const response = await fetch(videoAssignModal ? `/api/imports/${selectedVideoId}/assign-animal` : `/api/my/animals/${animal._id}/weights`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(videoAssignModal ? { animalId: animal._id } : {}), weight, measuredAt: measurementDate }) });
      const data = await readJson<{ error?: string; }>(response); if (!response.ok) throw new Error(data.error ?? "No se pudo guardar el registro.");
      setWeightModal(null); setVideoAssignModal(null);
      try { await refreshAnimals(); notify(videoAssignModal ? "Vídeo y pesaje guardados. El seguimiento del animal está actualizado." : "Pesaje registrado. La evolución del animal está actualizada."); } catch { notify("Registro guardado. No se pudo actualizar la lista; recarga la página para ver los datos más recientes.", true); }
    } catch (error) { setModalError(error instanceof Error ? error.message : "No se pudo guardar. Comprueba tu conexión."); } finally { setBusy(false); }
  }
  if (status === "loading") return <div className="p-6 text-sm text-slate-500">Cargando animales…</div>;
  if (!canView) return <div className="p-6 text-sm text-slate-600">No tienes acceso a esta sección.</div>;
  const filteredAnimals = animals.filter((animal) => `${animal.earTagNumber} ${animal.name ?? ""} ${animal.breed}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  const activeMeasurementAnimal = videoAssignModal ?? weightModal;
  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-6 p-4 sm:p-7 lg:p-9">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#52705e]">Administración / Ganado</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Animales</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Identificación, pesajes y vídeos. Cada registro cuenta la evolución de tu ganado.</p>
        </div>{canManage && <button type="button" onClick={() => setShowCreate((value) => !value)} className={primary} aria-expanded={showCreate} aria-controls="new-animal">{showCreate ? "Cerrar formulario" : "+ Nuevo animal"}
        </button>}
      </header>
      {notice && <div role={notice.error ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${notice.error ? "border-red-200 bg-red-50 text-red-800" : "border-[#cbded1] bg-[#edf4ed] text-[#31574b]"}`}>{notice.text}
      </div>}
      <section aria-label="Filtros de animales" className="rounded-lg border border-[#e1e5e1] bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="grid min-w-[180px] flex-1 gap-2 text-xs font-medium text-slate-600">Finca<select value={ranchId} onChange={(event) => { setRanchId(event.target.value); setLotId(""); setAnimals([]); setLots([]); }} className={field}>{!ranches.length && <option value="">Sin fincas disponibles</option>}{ranches.map((ranch) => <option key={ranch._id} value={ranch._id}>{ranch.name}
          </option>)}
          </select>
          </label>
          <label className="grid min-w-[180px] flex-1 gap-2 text-xs font-medium text-slate-600">Lote<select value={lotId} onChange={(event) => setLotId(event.target.value)} className={field}>
            <option value="">Todos los lotes</option>{lots.map((lot) => <option key={lot._id} value={lot._id}>{lot.name}
            </option>)}
          </select>
          </label>
          <label className="grid min-w-[200px] flex-1 gap-2 text-xs font-medium text-slate-600">Buscar animal<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Crotal, nombre o raza" className={field} />
          </label>{canManage && <button type="button" onClick={() => void syncRemoteAnimals()} disabled={!ranchId || syncing || busy} className={`${secondary} min-h-[42px]`}>{syncing ? "Actualizando…" : "Actualizar datos"}
          </button>}
        </div>
      </section>
      {canManage && showCreate && <section id="new-animal" className="rounded-lg border border-[#cbd8cc] bg-white p-5 sm:p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900">Nuevo animal</h2>
          <p className="mt-1 text-sm text-slate-500">Completa su identificación. Si añades un vídeo, indica también el peso y la fecha.</p>
        </div>
        <form onSubmit={createAnimal} className="space-y-6">
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="mb-3 text-sm font-semibold text-slate-700">Identificación</legend>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Lote *<select required value={lotId} onChange={(event) => setLotId(event.target.value)} className={field}>
              <option value="">Selecciona un lote</option>{lots.map((lot) => <option value={lot._id} key={lot._id}>{lot.name}
              </option>)}
            </select>
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Crotal / Identificador *<input required list="ear-tag-options" value={form.earTagNumber} onChange={(event) => setForm({ ...form, earTagNumber: event.target.value })} className={field} placeholder="Ej. ES012345678901" />
              <datalist id="ear-tag-options">{metadata.earTagOptions.map((tag) => <option value={tag} key={tag} />)}
              </datalist>
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Nombre<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={field} placeholder="Opcional" />
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Especie *<select required value={form.specie} onChange={(event) => setForm({ ...form, specie: event.target.value, breed: "" })} className={field}>{(metadata.specieOptions.length ? metadata.specieOptions : Object.keys(species).map((value) => ({ value, label: species[value] }))).map((option) => <option key={option.value} value={option.value}>{species[option.value] ?? option.label}
            </option>)}
            </select>
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Sexo *<select required value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })} className={field}>{(metadata.sexOptions.length ? metadata.sexOptions : Object.keys(sexes).map((value) => ({ value, label: sexes[value] }))).map((option) => <option key={option.value} value={option.value}>{sexes[option.value] ?? option.label}
            </option>)}
            </select>
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Raza<input list="breed-options" value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} className={field} placeholder="Opcional" />
              <datalist id="breed-options">{(metadata.breedOptionsBySpecie[form.specie] ?? []).map((breed) => <option value={breed} key={breed} />)}
              </datalist>
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Fecha de referencia *<select value={form.dateType} onChange={(event) => setForm({ ...form, dateType: event.target.value as "birth" | "purchase", dateValue: "" })} className={field}>
              <option value="birth">Nacimiento</option>
              <option value="purchase">Compra</option>
            </select>
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">{form.dateType === "birth" ? "Fecha de nacimiento *" : "Fecha de compra *"}<input required type="date" max={today()} value={form.dateValue} onChange={(event) => setForm({ ...form, dateValue: event.target.value })} className={field} />
            </label>
          </fieldset>
          <fieldset disabled={busy} className="grid gap-4 border-t border-[#e1e5e1] pt-5 sm:grid-cols-2">
            <legend className="pt-5 text-sm font-semibold text-slate-700">Primer seguimiento</legend>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Peso inicial (kg){form.video ? " *" : ""}<input required={!!form.video} type="number" min="0.01" step="any" value={form.initialWeight} onChange={(event) => setForm({ ...form, initialWeight: event.target.value })} placeholder="Ej. 300" className={field} />
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Fecha del pesaje{form.initialWeight || form.video ? " *" : ""}<input required={!!form.initialWeight || !!form.video} type="date" max={today()} value={form.measuredAt} onChange={(event) => setForm({ ...form, measuredAt: event.target.value })} className={field} />
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Fotografía<input type="file" accept="image/*" onChange={(event) => setForm({ ...form, photo: event.target.files?.[0] ?? null })} className={field} />
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Vídeo del pesaje<input type="file" accept="video/*" required={!!form.initialWeight} onChange={(event) => setForm({ ...form, video: event.target.files?.[0] ?? null })} className={field} />
              <span className="font-normal text-slate-500">Se guardará en la sección Vídeos con su peso y fecha.</span>
            </label>
          </fieldset>
          <details className="border-t border-[#e1e5e1] pt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-600">Más datos del animal</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="grid gap-2 text-xs font-medium text-slate-600">Color<input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} className={field} />
              </label>
              <label className="grid gap-2 text-xs font-medium text-slate-600">Número de marca<input value={form.brandNumber} onChange={(event) => setForm({ ...form, brandNumber: event.target.value })} className={field} />
              </label>
              <label className="grid gap-2 text-xs font-medium text-slate-600">Dispositivo<select value={form.deviceId} onChange={(event) => setForm({ ...form, deviceId: event.target.value })} className={field}>
                <option value="">Sin dispositivo</option>{metadata.deviceOptions.map((device) => <option key={device.value} value={device.value} disabled={device.disabled}>{device.label}{device.assignedAnimalLabel ? ` · Asignado a ${device.assignedAnimalLabel}` : ""}
                </option>)}
              </select>
              </label>
            </div>
          </details>{metadata.remoteError && <p className="text-xs text-amber-700">No se pudieron obtener todas las sugerencias: {metadata.remoteError}
          </p>}<div className="flex justify-end gap-3 border-t border-[#e1e5e1] pt-4">
            <button type="button" onClick={() => setShowCreate(false)} disabled={busy} className={secondary}>Cancelar</button>
            <button type="submit" disabled={busy || !lotId} className={primary}>{busy ? "Guardando…" : "Crear animal"}
            </button>
          </div>
        </form>
      </section>}
      <section className="overflow-hidden rounded-lg border border-[#e1e5e1] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#e1e5e1] px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Ganado <span className="ml-2 text-xs font-normal text-slate-500">{filteredAnimals.length} animales</span>
          </h2>
          <p className="text-xs text-slate-500">Evolución respecto al pesaje anterior</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-[#f8f9f6] text-xs font-medium text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Animal</th>
                <th className="px-4 py-3 font-medium">Lote y raza</th>
                <th className="px-4 py-3 font-medium">Último pesaje</th>
                <th className="px-4 py-3 font-medium">Evolución</th>
                <th className="px-5 py-3 text-right font-medium">Seguimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0eb]">{!loading && filteredAnimals.map((animal) => <tr key={animal._id} className="align-top hover:bg-[#fafbf8]">
              <td className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <span title={animal.syncError ?? (animal.syncStatus === "synced" ? "Sincronizado" : animal.syncStatus === "failed" ? "Error de sincronización" : "Sincronización pendiente")} className={`h-1.5 w-1.5 shrink-0 rounded-full ${animal.syncStatus === "synced" ? "bg-[#568069]" : animal.syncStatus === "failed" ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="font-semibold text-slate-900">{animal.earTagNumber || "Sin crotal"}
                  </span>
                </div>
                <p className="mt-1 pl-3.5 text-xs text-slate-500">{animal.name ? `${animal.name} · ` : ""}{species[animal.specie ?? ""] ?? animal.specie ?? "Animal"} · {sexes[animal.sex] ?? animal.sex}
                </p>{animal.syncStatus === "failed" && canManage && <button type="button" disabled={busy} onClick={() => void retrySync(animal._id)} className="mt-1 pl-3.5 text-xs text-amber-800 underline underline-offset-2">Reintentar sincronización</button>}
              </td>
              <td className="px-4 py-4">
                <p className="text-slate-700">{lots.find((lot) => lot._id === animal.lotId)?.name ?? "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500">{animal.breed || "Raza sin indicar"}
                </p>
              </td>
              <td className="px-4 py-4">
                <p className="font-semibold tabular-nums text-slate-900">{animal.latestWeight ? `${kilos(animal.latestWeight.weight)} kg` : animal.currentWeight > 0 ? `${kilos(animal.currentWeight)} kg` : "Sin peso"}
                </p>
                <p className="mt-1 text-xs text-slate-500">{dateLabel(animal.latestWeight?.measuredAt)}
                </p>
              </td>
              <td className="px-4 py-4">
                <p className={`font-medium tabular-nums ${(animal.weightChangeKg ?? 0) < 0 ? "text-red-700" : (animal.weightChangeKg ?? 0) > 0 ? "text-[#31574b]" : "text-slate-500"}`}>{animal.latestWeight ? delta(animal.weightChangeKg) : "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500">{animal.latestWeight?.previousMeasuredAt ? `Desde el ${dateLabel(animal.latestWeight.previousMeasuredAt)}` : animal.latestWeight ? "Sin pesaje anterior" : "Pendiente de registrar"}
                </p>
              </td>
              <td className="px-5 py-4">
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setHistoryAnimal(animal)} className="rounded-md border border-[#d8dfd8] px-2.5 py-1.5 text-xs text-slate-600 hover:bg-[#f6f7f4]">Historial</button>{canManage && <>

                    <button type="button" disabled={busy} onClick={() => void openVideoModal(animal)} className="rounded-md bg-[#edf3ed] px-2.5 py-1.5 text-xs font-medium text-[#31574b] hover:bg-[#e2ebe2]">+ Vídeo</button>
                    <button type="button" disabled={busy} onClick={() => { setDeleteModal(animal); setModalError(""); }} aria-label={`Eliminar animal ${animal.earTagNumber}`} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                      </svg>
                    </button>
                  </>}
                </div>
              </td>
            </tr>)}{(loading || !filteredAnimals.length) && <tr>
              <td colSpan={5} className="px-5 py-16 text-center">
                <p className="text-sm text-slate-600">{loading ? "Cargando animales…" : query ? "No hay animales que coincidan con tu búsqueda." : "Todavía no hay animales en esta selección."}
                </p>{!loading && !query && canManage && <button type="button" onClick={() => setShowCreate(true)} className="mt-3 text-sm font-medium text-[#31574b] underline underline-offset-4">Añadir el primer animal</button>}
              </td>
            </tr>}
            </tbody>
          </table>
        </div>
      </section>
      {activeMeasurementAnimal && <Modal title={videoAssignModal ? "Añadir vídeo y pesaje" : "Registrar pesaje"} busy={busy} onClose={() => { setWeightModal(null); setVideoAssignModal(null); }}>
        <form onSubmit={submitMeasurement} className="space-y-5">
          <div className="rounded-md border border-[#e1e5e1] bg-[#f8f9f6] p-3">
            <p className="text-sm font-semibold text-slate-800">{activeMeasurementAnimal.earTagNumber}{activeMeasurementAnimal.name ? ` · ${activeMeasurementAnimal.name}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500">Último peso: {activeMeasurementAnimal.currentWeight > 0 ? `${kilos(activeMeasurementAnimal.currentWeight)} kg` : "Sin registrar"}{activeMeasurementAnimal.latestWeight ? ` · ${dateLabel(activeMeasurementAnimal.latestWeight.measuredAt)}` : ""}
            </p>
          </div>{videoAssignModal && <label className="grid gap-2 text-xs font-medium text-slate-600">Buscar registro de vídeo y peso *<input type="search" value={videoQuery} onChange={(event) => setVideoQuery(event.target.value)} className={field} placeholder="Buscar por nombre, peso o fecha" /><select required disabled={videosLoading || busy} value={selectedVideoId} onChange={(event) => { setSelectedVideoId(event.target.value); const record = videoImports.find((video) => video._id === event.target.value); setWeightInput(record?.weight?.toString() ?? ""); setMeasurementDate(record?.measuredAt?.slice(0, 10) ?? ""); }} className={field}>
            <option value="">{videosLoading ? "Cargando vídeos…" : "Selecciona un vídeo"}
            </option>{videoImports.filter((video) => `${video.filename} ${video.weight ?? ""} ${video.measuredAt ?? ""}`.toLocaleLowerCase("es").includes(videoQuery.toLocaleLowerCase("es"))).map((video) => <option value={video._id} key={video._id} disabled={video.weight == null}>{video.filename} · {video.weight ?? "Sin peso"} kg · {video.measuredAt?.slice(0,10) ?? "Sin fecha"}{video.animalId ? " · Disponible para otro animal" : ""}
            </option>)}
          </select>
            <span className="font-normal leading-5 text-slate-500">El mismo vídeo y peso puede añadirse a animales de otros lotes. Gestiona la galería desde <Link className="text-[#31574b] underline underline-offset-2" href={`/dashboard/admin/imports?lotId=${activeMeasurementAnimal.lotId}&ranchId=${ranchId}`}>Vídeos</Link>. Allí también puedes subir archivos nuevos.</span>
          </label>}<div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-xs font-medium text-slate-600">Peso (kg) *<input autoFocus required readOnly disabled={busy} type="number" min="0.01" step="any" inputMode="decimal" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} placeholder="Ej. 500" className={field} />
            </label>
            <label className="grid gap-2 text-xs font-medium text-slate-600">Fecha del pesaje *<input required readOnly disabled={busy} type="date" max={today()} value={measurementDate} onChange={(event) => setMeasurementDate(event.target.value)} className={field} />
            </label>
          </div>
          <p className="text-xs leading-5 text-slate-500">La ganancia o pérdida se calcula respecto al pesaje anterior por fecha. Los registros antiguos se incorporan en su lugar en el historial.</p>{modalError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{modalError}
          </p>}<div className="flex justify-end gap-3 border-t border-[#e1e5e1] pt-4">
            <button type="button" disabled={busy} onClick={() => { setWeightModal(null); setVideoAssignModal(null); }} className={secondary}>Cancelar</button>
            <button type="submit" disabled={busy || (videoAssignModal != null && !selectedVideoId)} className={primary}>{busy ? "Guardando…" : videoAssignModal ? "Guardar vídeo y peso" : "Guardar pesaje"}
            </button>
          </div>
        </form>
      </Modal>}
      {historyAnimal && <Modal title={`Historial · ${historyAnimal.earTagNumber}`} onClose={() => setHistoryAnimal(null)}>
        <p className="mb-5 text-sm leading-6 text-slate-500">Pesajes ordenados del más reciente al más antiguo. La variación compara cada registro con el pesaje anterior.</p>
        <AnimalWeightHistory records={historyAnimal.weightHistory} videos={historyAnimal.videos} />
        <div className="mt-5 border-t border-[#e1e5e1] pt-4">
          <Link href={`/dashboard/admin/imports?ranchId=${ranchId}&lotId=${historyAnimal.lotId}`} className="text-sm font-medium text-[#31574b] underline underline-offset-4">Ver vídeos del lote</Link>
        </div>
      </Modal>}
      {deleteModal && <Modal title="Eliminar animal" busy={busy} onClose={() => setDeleteModal(null)}>
        <p className="text-sm leading-6 text-slate-600">Se eliminará el animal <strong className="text-slate-900">{deleteModal.earTagNumber}{deleteModal.name ? ` · ${deleteModal.name}` : ""}
        </strong> de la aplicación y de Ixorigue si está sincronizado. Esta acción no se puede deshacer.</p>{modalError && <p role="alert" className="mt-4 text-sm text-red-700">{modalError}
        </p>}<div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={() => setDeleteModal(null)} className={secondary}>Cancelar</button>
          <button type="button" disabled={busy} onClick={() => void deleteAnimal()} className="rounded-md bg-red-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">{busy ? "Eliminando…" : "Eliminar animal"}
          </button>
        </div>
      </Modal>}
    </main>
  );
}
