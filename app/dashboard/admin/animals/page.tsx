"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canMutateAdminData, canViewAdminScreens } from "@/lib/permissions";

type Ranch = { _id: string; name: string };
type Lot = { _id: string; ranchId: string; name: string };
type Animal = {
  _id: string;
  lotId: string;
  earTagNumber: string;
  breed: string;
  sex: string;
  specie?: string | null;
  name?: string | null;
  currentWeight: number;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string | null;
  /** Set when the animal exists in Ixorigue (search by this ID in the ranch). */
  ixorigueAnimalId?: string | null;
  brandNumber?: string;
  color?: string;
  initialWeight?: number;
};
type Option = { value: string; label: string };
type DeviceOption = { value: string; label: string; disabled: boolean; assignedAnimalLabel: string | null };
type MetadataResponse = {
  specieOptions: Option[];
  sexOptions: Option[];
  breedOptionsBySpecie: Record<string, string[]>;
  earTagOptions: string[];
  deviceOptions: DeviceOption[];
  remoteError: string | null;
};

const emptyMetadata: MetadataResponse = {
  specieOptions: [],
  sexOptions: [],
  breedOptionsBySpecie: {},
  earTagOptions: [],
  deviceOptions: [],
  remoteError: null,
};

async function readJsonSafely<T>(response: Response): Promise<T> {
  const raw = await response.text();

  if (!raw) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export default function AdminAnimalsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [ranches, setRanches] = useState<Ranch[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [metadata, setMetadata] = useState<MetadataResponse>(emptyMetadata);
  const [ranchId, setRanchId] = useState("");
  const [lotId, setLotId] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [weightModal, setWeightModal] = useState<Animal | null>(null);
  const [weightInput, setWeightInput] = useState("");
  const canView = session ? canViewAdminScreens(session.user.role) : false;
  const canManage = session ? canMutateAdminData(session.user.role) : false;
  const [form, setForm] = useState({
    specie: "cow",
    breed: "",
    name: "",
    sex: "female",
    color: "",
    brandNumber: "",
    earTagNumber: "",
    deviceId: "",
    initialWeight: "",
    dateType: "birth" as "birth" | "purchase",
    dateValue: "",
    photo: null as File | null,
    video: null as File | null,
  });

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) {
      return;
    }

    async function loadRanches() {
      const response = await fetch("/api/admin/ranches", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { ranches: Ranch[] };
      setRanches(data.ranches);
      const requestedRanchId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ranchId") : null;
      setRanchId((current) => current || (requestedRanchId && data.ranches.some((ranch) => ranch._id === requestedRanchId) ? requestedRanchId : data.ranches[0]?._id || ""));
    }

    void loadRanches();
  }, [canView, status]);

  useEffect(() => {
    async function loadLots() {
      if (!ranchId) {
        setLots([]);
        setLotId("");
        return;
      }
      const response = await fetch(`/api/admin/lots?ranchId=${ranchId}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { lots: Lot[] };
      setLots(data.lots);
      const requestedLotId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lotId") : null;
      setLotId((current) => (
        data.lots.some((lot) => lot._id === current)
          ? current
          : requestedLotId && data.lots.some((lot) => lot._id === requestedLotId)
            ? requestedLotId
            : data.lots[0]?._id || ""
      ));
    }

    void loadLots();
  }, [ranchId]);

  useEffect(() => {
    async function loadAnimals() {
      if (!ranchId) {
        setAnimals([]);
        return;
      }

      const searchParams = new URLSearchParams();
      searchParams.set("ranchId", ranchId);
      if (lotId) {
        searchParams.set("lotId", lotId);
      }
      const response = await fetch(`/api/admin/animals?${searchParams.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { animals: Animal[] };
      setAnimals(data.animals);
    }

    void loadAnimals();
  }, [lotId, ranchId]);

  useEffect(() => {
    async function loadMetadata() {
      if (!ranchId) {
        setMetadata(emptyMetadata);
        return;
      }

      const response = await fetch(`/api/admin/animals/metadata?ranchId=${ranchId}`, { cache: "no-store" });
      if (!response.ok) {
        setMetadata(emptyMetadata);
        return;
      }

      const data = (await response.json()) as MetadataResponse;
      setMetadata(data);
      setForm((current) => ({
        ...current,
        specie: data.specieOptions.some((item) => item.value === current.specie) ? current.specie : data.specieOptions[0]?.value || "cow",
        sex: data.sexOptions.some((item) => item.value === current.sex) ? current.sex : data.sexOptions[0]?.value || "female",
      }));
    }

    void loadMetadata();
  }, [ranchId]);

  async function refreshAnimals() {
    const response = await fetch(`/api/admin/animals?ranchId=${ranchId}${lotId ? `&lotId=${lotId}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const next = (await response.json()) as { animals: Animal[] };
    setAnimals(next.animals);
  }

  async function createAnimal() {
    const payload = new FormData();
    payload.set("lotId", lotId);
    payload.set("specie", form.specie);
    payload.set("name", form.name);
    payload.set("sex", form.sex);
    payload.set("earTagNumber", form.earTagNumber);
    if (form.breed) payload.set("breed", form.breed);
    if (form.color) payload.set("color", form.color);
    if (form.brandNumber) payload.set("brandNumber", form.brandNumber);
    if (form.deviceId) payload.set("deviceId", form.deviceId);
    if (form.initialWeight) payload.set("initialWeight", form.initialWeight);
    if (form.dateValue) {
      payload.set(form.dateType === "birth" ? "birthDate" : "dateOfPurchase", form.dateValue);
    }
    if (form.photo) payload.set("photo", form.photo);
    if (form.video) payload.set("video", form.video);

    const response = await fetch("/api/admin/animals", {
      method: "POST",
      body: payload,
    });

    const data = await readJsonSafely<{ error?: string; animal?: Animal }>(response);
    setMessage(response.ok ? "Animal created and synced." : data.error ?? "Failed to create animal.");
    if (response.ok) {
      await refreshAnimals();
      setForm({
        specie: form.specie,
        breed: "",
        name: "",
        sex: form.sex,
        color: "",
        brandNumber: "",
        earTagNumber: "",
        deviceId: "",
        initialWeight: "",
        dateType: form.dateType,
        dateValue: "",
        photo: null,
        video: null,
      });
    }
  }

  async function retrySync(animalId: string) {
    const response = await fetch(`/api/admin/animals/${animalId}/retry-sync`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Sync retried." : data.error ?? "Retry failed.");
  }

  async function deleteAnimal(animalId: string) {
    if (!window.confirm("Delete this animal? This will remove it locally and from Ixorigue if synced.")) {
      return;
    }
    const response = await fetch(`/api/admin/animals/${animalId}`, { method: "DELETE" });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Animal deleted." : data.error ?? "Delete failed.");
    if (response.ok) {
      setAnimals((current) => current.filter((animal) => animal._id !== animalId));
    }
  }

  async function syncRemoteAnimals() {
    if (!ranchId) {
      return;
    }
    setSyncing(true);
    const response = await fetch(`/api/admin/ranches/${ranchId}/sync-animals`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Remote animals synced." : data.error ?? "Sync failed.");
    if (response.ok) {
      await refreshAnimals();
    }
    setSyncing(false);
  }

  async function submitWeight(animalId: string, weightKg: number) {
    const response = await fetch(`/api/my/animals/${animalId}/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weight: weightKg }),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Weight recorded." : data.error ?? "Weight update failed.");
    if (response.ok) {
      setWeightModal(null);
      setWeightInput("");
      await refreshAnimals();
    }
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  }
  if (!canView) {
    return <main className="p-6 text-sm text-slate-600">Forbidden</main>;
  }

  const breedOptions = metadata.breedOptionsBySpecie[form.specie] ?? [];

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Animals</h1>
          <p className="mt-1 text-sm text-slate-600">Create animals with the same core fields Ixorigue requires so sync succeeds on first submit.</p>
          {!canManage ? (
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Institutional users can review ranch animals and sync status here, but animal creation and edit actions remain admin-only.
            </p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            After create, the backend registers the animal in Ixorigue and <strong>adds it to the selected lot</strong> so it appears in the Ixorigue app under that lot.
            If sync fails, read the error in the table; use <strong>Retry sync</strong>. The <strong>Ixorigue ID</strong> column shows the remote GUID when sync succeeded (search the animal in Ixorigue by ranch).
            If dropdowns show a warning, Ixorigue metadata could not be loaded — check API credentials and the server terminal for <code className="rounded bg-slate-100 px-1">[Ixorigue]</code> logs.
          </p>

          {canManage ? (
            <div className="mt-4 grid gap-4">
            <section className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-900">Required fields</h2>
                <p className="text-sm text-slate-500">These are the fields directly tied to Pastora and the base sync workflow.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Ranch</span>
                  <select value={ranchId} onChange={(event) => setRanchId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {ranches.map((ranch) => (
                      <option key={ranch._id} value={ranch._id}>{ranch.name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Lot</span>
                  <select value={lotId} onChange={(event) => setLotId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">Select lot</option>
                    {lots.map((lot) => (
                      <option key={lot._id} value={lot._id}>{lot.name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Specie</span>
                  <select value={form.specie} onChange={(event) => setForm((current) => ({ ...current, specie: event.target.value, breed: "" }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {metadata.specieOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Animal ID / ear tag</span>
                  <input list="ear-tag-options" value={form.earTagNumber} onChange={(event) => setForm((current) => ({ ...current, earTagNumber: event.target.value }))} placeholder="Enter ear tag" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <datalist id="ear-tag-options">
                    {metadata.earTagOptions.map((earTag) => (
                      <option key={earTag} value={earTag} />
                    ))}
                  </datalist>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Sex</span>
                  <select value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {metadata.sexOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{form.dateType === "birth" ? "Birth date" : "Purchase date"}</span>
                  <div className="grid gap-3 sm:grid-cols-[180px,1fr]">
                    <select value={form.dateType} onChange={(event) => setForm((current) => ({ ...current, dateType: event.target.value as "birth" | "purchase", dateValue: "" }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="birth">Birth date</option>
                      <option value="purchase">Purchase date</option>
                    </select>
                    <input type="date" value={form.dateValue} onChange={(event) => setForm((current) => ({ ...current, dateValue: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </div>
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-900">Optional fields</h2>
                <p className="text-sm text-slate-500">Additional attributes, media and enrichment fields for this animal.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Animal name</span>
                  <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Optional animal name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Breed</span>
                  <input list="breed-options" value={form.breed} onChange={(event) => setForm((current) => ({ ...current, breed: event.target.value }))} placeholder="Optional breed" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <datalist id="breed-options">
                    {breedOptions.map((breed) => (
                      <option key={breed} value={breed} />
                    ))}
                  </datalist>
                  <span className="text-xs text-slate-500">Suggestions come from animals already synced in this ranch.</span>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Device</span>
                  <select value={form.deviceId} onChange={(event) => setForm((current) => ({ ...current, deviceId: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">No device</option>
                    {metadata.deviceOptions.map((device) => (
                      <option key={device.value} value={device.value} disabled={device.disabled}>
                        {device.label}{device.assignedAnimalLabel ? ` · assigned to ${device.assignedAnimalLabel}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Initial weight</span>
                  <input value={form.initialWeight} onChange={(event) => setForm((current) => ({ ...current, initialWeight: event.target.value }))} placeholder="Optional initial weight" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Color</span>
                  <input value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} placeholder="Optional color" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Brand number</span>
                  <input value={form.brandNumber} onChange={(event) => setForm((current) => ({ ...current, brandNumber: event.target.value }))} placeholder="Optional brand number" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Photo</span>
                  <input type="file" accept="image/*" onChange={(event) => setForm((current) => ({ ...current, photo: event.target.files?.[0] ?? null }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Video</span>
                  <input type="file" accept="video/*" onChange={(event) => setForm((current) => ({ ...current, video: event.target.files?.[0] ?? null }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>
            </section>
            </div>
          ) : null}

          {metadata.remoteError ? <p className="mt-3 text-sm text-amber-700">Ixorigue dropdown fetch warning: {metadata.remoteError}</p> : null}
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {canManage ? (
              <>
                <button type="button" onClick={() => void createAnimal()} disabled={!lotId} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-60">
                  Create animal
                </button>
                <button type="button" onClick={() => void syncRemoteAnimals()} disabled={!ranchId || syncing} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">
                  {syncing ? "Syncing..." : "Pull remote animals"}
                </button>
              </>
            ) : (
              <span className="text-sm text-slate-500">Read only</span>
            )}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">Ear tag</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Specie</th>
                  <th className="px-3 py-2">Sex</th>
                  <th className="px-3 py-2">Breed</th>
                  <th className="px-3 py-2">Current weight</th>
                  <th className="px-3 py-2">Ixorigue ID</th>
                  <th className="px-3 py-2">Sync</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {animals.map((animal) => (
                  <tr key={animal._id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{animal.earTagNumber}</td>
                    <td className="px-3 py-2">{animal.name ?? "-"}</td>
                    <td className="px-3 py-2">{animal.specie ?? "-"}</td>
                    <td className="px-3 py-2">{animal.sex}</td>
                    <td className="px-3 py-2">{animal.breed || "-"}</td>
                    <td className="px-3 py-2">{animal.currentWeight}</td>
                    <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs" title={animal.ixorigueAnimalId ?? ""}>
                      {animal.ixorigueAnimalId ?? "—"}
                    </td>
                    <td className="px-3 py-2">{animal.syncStatus}{animal.syncError ? ` · ${animal.syncError}` : ""}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => { setWeightModal(animal); setWeightInput(""); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">Add weight</button>
                          <button type="button" onClick={() => void retrySync(animal._id)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">Retry sync</button>
                          <button type="button" onClick={() => void deleteAnimal(animal._id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50">Delete</button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canManage && weightModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setWeightModal(null)}>
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg" onClick={(event) => event.stopPropagation()}>
              <h2 className="text-lg font-semibold text-slate-900">Add weight</h2>
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <p><span className="font-medium">Ear tag:</span> {weightModal.earTagNumber}</p>
                <p><span className="font-medium">Name:</span> {weightModal.name ?? "-"}</p>
                <p><span className="font-medium">Breed:</span> {weightModal.breed || "-"} · <span className="font-medium">Sex:</span> {weightModal.sex}</p>
                <p><span className="font-medium">Current weight:</span> {weightModal.currentWeight} kg</p>
              </div>
              <label className="mt-4 block text-xs font-medium text-slate-600">New weight (kg)</label>
              <input type="number" step="0.1" min="0" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} placeholder="e.g. 210" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setWeightModal(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
                <button type="button" onClick={() => { const weight = Number(weightInput); if (Number.isFinite(weight) && weight > 0) void submitWeight(weightModal._id, weight); else setMessage("Enter a valid weight."); }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">Save</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
