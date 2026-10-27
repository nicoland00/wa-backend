"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import MapView from "@/components/MapView";
import AdminShell from "@/components/AdminShell";
import AnimalWeightHistory, { AnimalWeightSummary, formatRecordDate, type WeightRecord, type AnimalHistoryVideo } from "@/components/AnimalWeightHistory";
import { canViewAdminScreens } from "@/lib/permissions";
import type { Lot as MapLot } from "@/lib/api";

type Ranch = { _id: string; name: string; ixorigueRanchId: string | null; syncStatus: string; syncError: string | null };
type Lot = { _id: string; ranchId: string; name: string; ixorigueLotId: string | null; geometry: { type: "Polygon"; coordinates: number[][][] } | null };
type Animal = {
  _id: string; lotId: string; name?: string | null; specie?: string | null; sex: string; breed: string; color: string;
  brandNumber: string; earTagNumber: string; initialWeight?: number; currentWeight: number; lifeStatus: string;
  birthDate?: string | null; dateOfPurchase?: string | null; syncStatus?: string; syncError?: string | null;
  photoUrl: string | null; videoUrl: string | null; videos?: AnimalHistoryVideo[]; weightHistory?: WeightRecord[];
  latestWeight?: WeightRecord | null; weightChangeKg?: number | null; coordinates?: { lat: number; lng: number } | null;
};
type MapResponse = { ranch: Ranch; lots: Lot[]; animals: Animal[] };
const RANCH_KEY = "pastora.dashboard.selectedRanchId";
const lotKey = (id: string) => `pastora.dashboard.selectedLotId:${id}`;
function readStored(key: string) { try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; } }
function store(key: string, value: string) { try { if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key); } catch {} }
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [ranchReloadKey, setRanchReloadKey] = useState(0);
  const [selectedRanchId, setSelectedRanchId] = useState("");
  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [activeAnimalId, setActiveAnimalId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showMap, setShowMap] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [showWeightForm, setShowWeightForm] = useState(false);
  const [weight, setWeight] = useState("");
  const [measuredAt, setMeasuredAt] = useState(today);
  const [savingWeight, setSavingWeight] = useState(false);
  const [weightError, setWeightError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedLotRef = useRef("");
  const selectedRanchRef = useRef("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const savingWeightRef = useRef(false);
  const hasAdminAccess = session ? canViewAdminScreens(session.user.role) : false;
  const canEditAdmin = session?.user.role === "admin";
  const canAddWeight = session?.user.role === "admin" || session?.user.role === "retail";

  useEffect(() => { if (status === "unauthenticated") router.replace("/login"); }, [router, status]);
  useEffect(() => { selectedLotRef.current = selectedLotId; }, [selectedLotId]);
  useEffect(() => { selectedRanchRef.current = selectedRanchId; }, [selectedRanchId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(hasAdminAccess ? "/api/admin/ranches" : "/api/my/ranches", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las fincas.");
        if (cancelled) return;
        setRanches(data.ranches);
        const saved = readStored(RANCH_KEY);
        setSelectedRanchId((current) => data.ranches.some((r: Ranch) => r._id === current) ? current : data.ranches.some((r: Ranch) => r._id === saved) ? saved : data.ranches[0]?._id ?? "");
      } catch { if (!cancelled) setError("No se pudieron cargar las fincas. Vuelve a intentarlo."); }
    })();
    return () => { cancelled = true; };
  }, [hasAdminAccess, status, ranchReloadKey]);

  const loadRanchMap = useCallback(async (ranchId: string, quiet = false) => {
    const requestId = ++requestRef.current;
    if (!ranchId) { setLots([]); setAnimals([]); setSelectedLotId(""); return; }
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/map/ranch/${ranchId}`, { cache: "no-store" });
      const data = await response.json() as MapResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar la finca.");
      if (requestRef.current !== requestId) return;
      setError("");
      const current = selectedLotRef.current;
      const saved = readStored(lotKey(ranchId));
      const nextLotId = data.lots.some((l) => l._id === current) ? current : data.lots.some((l) => l._id === saved) ? saved : "";
      setLots(data.lots); setAnimals(data.animals); setSelectedLotId(nextLotId); store(lotKey(ranchId), nextLotId);
    } catch { if (requestRef.current === requestId) setError("No se pudieron actualizar los animales. Vuelve a intentarlo."); }
    finally { if (requestRef.current === requestId) setLoading(false); }
  }, []);

  useEffect(() => {
    store(RANCH_KEY, selectedRanchId);
    void loadRanchMap(selectedRanchId);
    const refresh = () => { if (document.visibilityState === "visible") void loadRanchMap(selectedRanchId, true); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [selectedRanchId, loadRanchMap]);

  useEffect(() => {
    if (!activeAnimalId) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingWeightRef.current) setActiveAnimalId(null);
      if (event.key !== "Tab") return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), video[controls], [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", handleKey); triggerRef.current?.focus(); };
  }, [activeAnimalId]);

  useEffect(() => {
    if (activeAnimalId && !animals.some((animal) => animal._id === activeAnimalId)) setActiveAnimalId(null);
  }, [activeAnimalId, animals]);

  const selectedRanch = ranches.find((r) => r._id === selectedRanchId);
  const lotById = useMemo(() => new Map(lots.map((l) => [l._id, l])), [lots]);
  const activeAnimal = animals.find((a) => a._id === activeAnimalId);
  const visibleAnimals = animals.filter((a) => (!selectedLotId || a.lotId === selectedLotId) && [a.earTagNumber, a.brandNumber, a.name, a.breed].some((value) => value?.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => a.earTagNumber.localeCompare(b.earTagNumber));
  const mapLots = useMemo<MapLot[]>(() => lots.filter((l) => l.geometry).map((l) => ({ lotId: l._id, farmId: l.ranchId, name: l.name, ixorigueId: l.ixorigueLotId ?? l._id, geometry: l.geometry! })), [lots]);
  const mapAnimals = useMemo(() => animals.filter((a) => a.coordinates?.lat != null && a.coordinates?.lng != null).map((a) => ({ animalId: a._id, lotId: a.lotId, earTagNumber: a.earTagNumber, lotName: lotById.get(a.lotId)?.name ?? "Sin lote", breed: a.breed, sex: a.sex, currentWeight: a.currentWeight, coordinates: a.coordinates! })), [animals, lotById]);
  const recentCount = animals.filter((animal) => { const age = animal.latestWeight ? Date.now() - new Date(animal.latestWeight.measuredAt).getTime() : Infinity; return age >= 0 && age <= 30 * 24 * 60 * 60 * 1000; }).length;
  const videosCount = animals.reduce((count, animal) => count + (animal.videos?.length ?? 0), 0);

  function openAnimal(id: string) { setActiveAnimalId(id); setShowWeightForm(false); setWeight(""); setMeasuredAt(today()); setWeightError(""); setNotice(""); }
  function selectLot(id: string) { setSelectedLotId(id); selectedLotRef.current = id; store(lotKey(selectedRanchId), id); }
  async function triggerSync() {
    setSyncing(true); setError("");
    try { const response = await fetch(`/api/admin/ranches/${selectedRanchId}/sync-remote`, { method: "POST" }); if (!response.ok) throw new Error(); await loadRanchMap(selectedRanchId, true); }
    catch { setError("No se pudo sincronizar la finca. Puedes volver a intentarlo."); }
    finally { setSyncing(false); }
  }
  async function saveWeight(event: React.FormEvent) {
    event.preventDefault();
    if (!activeAnimal || savingWeight) return;
    if (!Number.isFinite(Number(weight)) || Number(weight) <= 0 || !measuredAt) { setWeightError("Indica un peso mayor que cero y la fecha del pesaje."); return; }
    savingWeightRef.current = true; setSavingWeight(true); setWeightError("");
    try {
      const response = await fetch(`/api/my/animals/${activeAnimal._id}/weights`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weight: Number(weight), measuredAt }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el peso.");
      await loadRanchMap(selectedRanchRef.current, true); setShowWeightForm(false); setWeight(""); setNotice("Pesaje guardado. El historial y la tarjeta están actualizados.");
    } catch (err) { setWeightError(err instanceof Error ? err.message : "No se pudo guardar el peso."); }
    finally { savingWeightRef.current = false; setSavingWeight(false); }
  }

  if (status === "loading") return <main className="flex min-h-screen items-center justify-center bg-[#f6f7f4]"><p className="text-sm text-slate-500" role="status">Cargando Pastora…</p></main>;
  if (!session) return null;

  return <AdminShell>
    <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-medium text-[#3f7561]">Pastora / Resumen</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Tu ganado, al día.</h1><p className="mt-1 text-sm text-slate-500">Pesos, vídeos y evolución de cada animal en un mismo lugar.</p></div>
        <div className="flex items-center gap-2">
          {hasAdminAccess ? <Link href={`/dashboard/admin/imports?ranchId=${selectedRanchId}${selectedLotId ? `&lotId=${selectedLotId}` : ""}`} className="rounded-lg bg-[#31574b] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#27473d]">{canEditAdmin ? "Subir vídeo" : "Ver vídeos"}</Link> : <><Link href="/dashboard/profile" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">Mi perfil</Link><button onClick={() => void signOut({ callbackUrl: "/login" })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Salir</button></>}
        </div>
      </header>
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}<button onClick={() => { if (selectedRanchId) void loadRanchMap(selectedRanchId); else setRanchReloadKey((key) => key + 1); }} className="font-medium underline">Reintentar</button></div> : null}
      <section className="rounded-xl border border-[#e1e5e1] bg-white" aria-label="Resumen de la finca">
        <div className="flex flex-wrap items-end gap-4 border-b border-[#e1e5e1] p-4 sm:px-5">
          <label className="grid min-w-44 flex-1 gap-1.5 text-xs font-medium text-slate-500 sm:max-w-64">Finca<select value={selectedRanchId} onChange={(event) => { setAnimals([]); setSelectedLotId(""); selectedLotRef.current = ""; setSelectedRanchId(event.target.value); }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800"><option value="" disabled>Selecciona una finca</option>{ranches.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</select></label>
          <label className="grid min-w-40 flex-1 gap-1.5 text-xs font-medium text-slate-500 sm:max-w-56">Lote<select value={selectedLotId} onChange={(event) => selectLot(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800"><option value="">Todos los lotes</option>{lots.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</select></label>
          {canEditAdmin && selectedRanch?.ixorigueRanchId ? <button disabled={syncing || loading} onClick={() => void triggerSync()} className="ml-auto rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">{syncing ? "Sincronizando…" : "Sincronizar finca"}</button> : null}
        </div>
        <dl className="grid grid-cols-2 divide-x divide-[#e1e5e1] sm:grid-cols-4">{[["Animales", animals.length], ["Lotes", lots.length], ["Pesados en 30 días", recentCount], ["Vídeos registrados", videosCount]].map(([label, value]) => <div key={label} className="px-5 py-4"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{loading ? "—" : value}</dd></div>)}</dl>
      </section>
      <section aria-label="Ubicación del ganado" className="overflow-hidden rounded-xl border border-[#e1e5e1] bg-white"><button onClick={() => setShowMap((visible) => !visible)} aria-expanded={showMap} aria-controls="ranch-map" className="flex w-full items-center justify-between px-5 py-3 text-left text-xs text-slate-600"><span>Ubicación del ganado <span className="ml-2 text-slate-400">{mapAnimals.length} animales con ubicación</span></span><span className="font-medium text-[#31574b]">{showMap ? "Ocultar mapa −" : "Ver mapa +"}</span></button>{showMap ? <div id="ranch-map"><MapView lots={mapLots} animals={mapAnimals} selectedLotId={selectedLotId || null} onSelectLot={selectLot} /></div> : null}</section>
      <section aria-label="Animales" aria-busy={loading}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-slate-900">{lotById.get(selectedLotId)?.name ?? "Animales"} <span className="ml-1 text-sm font-normal text-slate-400">{visibleAnimals.length}</span></h2><p className="mt-1 text-xs text-slate-500">Último pesaje y cambio respecto al anterior.</p></div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="relative flex-1 sm:flex-initial"><span className="sr-only">Buscar animal por crotal, nombre o raza</span><input type="search" placeholder="Buscar animal…" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm sm:w-56" /></label>
            <div className="flex rounded-lg border border-slate-200 bg-white p-1" aria-label="Vista de animales">{(["grid", "list"] as const).map((view) => <button key={view} onClick={() => setViewMode(view)} aria-pressed={viewMode === view} className={`rounded-md px-3 py-1.5 text-xs font-medium ${viewMode === view ? "bg-[#edf2ed] text-[#31574b]" : "text-slate-500"}`}>{view === "grid" ? "Tarjetas" : "Lista"}</button>)}</div>
          </div>
        </div>
        {loading ? <div role="status" className="rounded-xl border border-[#e1e5e1] bg-white p-12 text-center text-sm text-slate-500">Cargando animales…</div> : !visibleAnimals.length ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"><h3 className="text-sm font-medium text-slate-700">{search ? "No hay coincidencias" : "No hay animales en esta selección"}</h3><p className="mt-2 text-xs text-slate-500">{search ? "Prueba con otro crotal, nombre o raza." : "Selecciona otra finca o lote para ver sus animales."}</p>{hasAdminAccess && !search ? <Link href="/dashboard/admin/animals" className="mt-4 inline-block text-sm font-medium text-[#31574b] underline underline-offset-4">Gestionar animales</Link> : null}</div> : viewMode === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{visibleAnimals.map((animal) => <article key={animal._id} className="overflow-hidden rounded-xl border border-[#e1e5e1] bg-white transition-colors hover:border-[#8caa98]">
            <button onClick={() => openAnimal(animal._id)} className="block w-full text-left" aria-label={`Ver historial del animal ${animal.earTagNumber || animal.name}`}>
              <div className="relative aspect-[16/8] overflow-hidden bg-[#edf0e9]">{animal.videoUrl ? <><video src={animal.videoUrl} className="h-full w-full object-cover" preload="metadata" muted playsInline /><span className="absolute bottom-3 left-3 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white">{formatRecordDate(animal.videos?.[0]?.measuredAt ?? animal.videos?.[0]?.createdAt)}</span><span className="absolute bottom-3 right-3 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white">▷ {animal.videos?.length ?? 1} vídeo{(animal.videos?.length ?? 1) !== 1 ? "s" : ""}</span></> : <div className="flex h-full flex-col items-center justify-center gap-2 text-[#8e9b8a]"><svg width="42" height="32" viewBox="0 0 42 32" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M8 12 4 6l9 2m16 4 8-6-1 9M11 10c2-4 17-4 19 1l3 12-7 6H16l-7-6 2-13Z"/><path d="M15 17h.5m11 0h.5M15 24c2-3 9-3 12 0M19 26h.5m3 0h.5"/></svg><span className="text-[11px]">Sin vídeo</span></div>}</div>
              <div className="p-4"><div className="mb-4 flex items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">{animal.earTagNumber || animal.name || "Sin crotal"}</h3><p className="mt-1 text-xs text-slate-500">{animal.breed || "Sin raza"} · {animal.sex || "Sin sexo"}</p></div><span className="rounded bg-[#f3f5f1] px-2 py-1 text-[10px] text-slate-500">{lotById.get(animal.lotId)?.name ?? "Sin lote"}</span></div><AnimalWeightSummary animal={animal} compact /><div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-xs"><span className="text-slate-400">{animal.weightHistory?.length ?? 0} pesajes</span><span className="font-medium text-[#3f7561]">Ver historial <span aria-hidden="true">↗</span></span></div></div>
            </button>
          </article>)}</div>
        ) : <div className="overflow-x-auto rounded-xl border border-[#e1e5e1] bg-white"><table className="w-full text-left text-sm"><thead className="border-b border-[#e1e5e1] bg-[#fafbf9] text-xs font-medium text-slate-500"><tr><th className="px-5 py-3 font-medium">Animal</th><th className="px-5 py-3 font-medium">Lote</th><th className="px-5 py-3 font-medium">Último pesaje</th><th className="px-5 py-3 font-medium">Vídeos</th><th className="px-5 py-3"><span className="sr-only">Acciones</span></th></tr></thead><tbody className="divide-y divide-slate-100">{visibleAnimals.map((animal) => <tr key={animal._id} className="hover:bg-[#fafbf9]"><td className="px-5 py-4"><p className="font-medium text-slate-900">{animal.earTagNumber || animal.name || "Sin crotal"}</p><p className="mt-1 text-xs text-slate-500">{animal.breed || "—"} · {animal.sex || "—"}</p></td><td className="px-5 py-4 text-xs text-slate-500">{lotById.get(animal.lotId)?.name ?? "—"}</td><td className="min-w-48 px-5 py-4"><AnimalWeightSummary animal={animal} compact /></td><td className="px-5 py-4 text-slate-500">{animal.videos?.length ?? 0}</td><td className="px-5 py-4"><button onClick={() => openAnimal(animal._id)} className="whitespace-nowrap rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-[#31574b]">Ver historial</button></td></tr>)}</tbody></table></div>}
      </section>
    </main>
    {activeAnimal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 sm:p-6" onClick={() => { if (!savingWeight) setActiveAnimalId(null); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="animal-title" tabIndex={-1} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white outline-none" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#e1e5e1] bg-white p-5 sm:px-7"><div><p className="text-xs text-slate-500">Ficha del animal · {lotById.get(activeAnimal.lotId)?.name ?? "Sin lote"}</p><h2 id="animal-title" className="mt-1 text-xl font-semibold text-slate-900">{activeAnimal.earTagNumber || activeAnimal.name || "Sin crotal"}</h2></div><button disabled={savingWeight} onClick={() => setActiveAnimalId(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-50" aria-label="Cerrar ficha del animal">Cerrar ×</button></header>
        <div className="space-y-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><AnimalWeightSummary animal={activeAnimal} />{canAddWeight ? <button disabled={savingWeight} onClick={() => { setShowWeightForm((open) => !open); setNotice(""); }} aria-expanded={showWeightForm} className="rounded-lg bg-[#31574b] px-3 py-2.5 text-xs font-medium text-white disabled:opacity-50">{showWeightForm ? "Cancelar pesaje" : "+ Registrar peso"}</button> : null}</div>
          {notice ? <p role="status" className="rounded-lg border border-[#d4e3d5] bg-[#f0f6ef] px-4 py-3 text-sm text-[#31574b]">{notice}</p> : null}
          {showWeightForm ? <form onSubmit={(event) => void saveWeight(event)} className="rounded-lg border border-[#d8e2d8] bg-[#f7f9f5] p-4"><h3 className="text-sm font-semibold text-slate-800">Nuevo pesaje</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">La comparación se calcula según la fecha del pesaje, también si registras un peso anterior.</p><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="grid gap-1.5 text-xs font-medium text-slate-600">Peso (kg)<input autoFocus type="number" inputMode="decimal" step="any" min="0.01" required value={weight} onChange={(event) => setWeight(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" placeholder="Ej. 500" disabled={savingWeight} /></label><label className="grid gap-1.5 text-xs font-medium text-slate-600">Fecha del pesaje<input type="date" required value={measuredAt} onChange={(event) => setMeasuredAt(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" disabled={savingWeight} /></label><button disabled={savingWeight} type="submit" className="self-end rounded-lg bg-[#31574b] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{savingWeight ? "Guardando…" : "Guardar peso"}</button></div>{weightError ? <p role="alert" className="mt-3 text-xs text-red-700">{weightError}</p> : null}</form> : null}
          <dl className="grid grid-cols-2 gap-4 rounded-lg border border-[#e1e5e1] bg-[#fafbf9] p-4 sm:grid-cols-4">{[["Raza", activeAnimal.breed || "—"], ["Sexo", activeAnimal.sex || "—"], ["Marca", activeAnimal.brandNumber || "—"], ["Nacimiento", activeAnimal.birthDate ? formatRecordDate(activeAnimal.birthDate) : "—"]].map(([label, value]) => <div key={label}><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-1 text-xs font-medium text-slate-800">{value}</dd></div>)}</dl>
          <AnimalWeightHistory records={activeAnimal.weightHistory} videos={activeAnimal.videos?.length ? activeAnimal.videos : activeAnimal.videoUrl ? [{ url: activeAnimal.videoUrl }] : []} />
          {hasAdminAccess ? <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">Puedes añadir y eliminar los vídeos de este animal desde <Link href={`/dashboard/admin/imports?ranchId=${selectedRanchId}&lotId=${activeAnimal.lotId}`} className="font-medium text-[#31574b] underline underline-offset-2">la sección de vídeos</Link>.</p> : null}
        </div>
      </div>
    </div> : null}
  </AdminShell>;
}
