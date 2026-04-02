import type { IxorigueAnimalDto, IxorigueAnimalUpsertInput, IxorigueAnimalWeightDto, IxorigueAnimalWeightInput, IxorigueDeviceDto, IxorigueEarTagDto, IxorigueLotDto, IxorigueLotUpsertInput, IxorigueMapDataDto, IxorigueRanchDto, IxorigueRanchOverviewDto, IxorigueRanchSettingsDto, IxorigueRanchSettingsInput } from "@/lib/ixorigue/types";

function unwrapData<T>(payload: unknown): T {
  const source = (payload ?? {}) as Record<string, unknown>;
  return (("data" in source ? source.data : payload) ?? null) as T;
}

export function mapUpdateRanchSettingsPayload(input: IxorigueRanchSettingsInput) {
  return {
    // TODO: confirm exact payload keys against live swagger.json
    ...input,
  };
}

/** Request body for POST /api/AnimalsLots/{ranchId} */
export function mapCreateLotPayload(input: IxorigueLotUpsertInput) {
  return {
    animals: input.animals ?? [],
    name: input.name,
    isFattening: input.isFattening ?? false,
    ...(input.zoneId != null && { zoneId: input.zoneId }),
    ...(input.hexRgbColor != null && { hexRgbColor: input.hexRgbColor }),
  };
}

export function mapUpdateLotPayload(input: IxorigueLotUpsertInput & { ixorigueLotId: string }) {
  return {
    LotId: input.ixorigueLotId,
    ...mapCreateLotPayload(input),
  };
}

/**
 * Request body for POST /api/Animals/{ranchId}
 * multipart/form-data — only the fields listed in Ixorigue spec, exact names.
 */
export function mapCreateAnimalPayload(input: IxorigueAnimalUpsertInput) {
  const formData = new FormData();

  const specie = input.specie.trim();
  const lotId = input.ixorigueLotId.trim();
  const name = (input.name ?? input.earTagNumber ?? "").trim() || input.earTagNumber.trim();
  const earTag = input.earTagNumber.trim();
  const sex = (typeof input.sex === "string" ? input.sex.toLowerCase() : "female").trim();
  const race = (input.breed ?? "").trim();
  const registerReason = (input.registerReason ?? "").trim();
  const birthDate = (input.birthDate ?? "").trim();
  const dateOfPurchase = (input.dateOfPurchase ?? "").trim();

  if (!specie) throw new Error("Specie is required");
  if (!lotId) throw new Error("LotId is required");
  if (!earTag) throw new Error("EarTag is required");
  if (!name) throw new Error("Name is required");
  if (!sex) throw new Error("Sex is required");
  if (!registerReason) throw new Error("RegisterReason is required");
  if (!birthDate && !dateOfPurchase) throw new Error("BirthDate or DateOfPurchase is required");

  formData.set("Specie", specie);
  formData.set("LotId", lotId);
  formData.set("Name", name);
  formData.set("EarTag", earTag);
  formData.set("Sex", sex);
  formData.set("RegisterReason", registerReason);

  if (race) formData.set("Race", race);
  if (birthDate) formData.set("BirthDate", birthDate);
  if (dateOfPurchase) formData.set("DateOfPurchase", dateOfPurchase);

  if (input.description?.trim()) formData.set("Description", input.description.trim());
  if (input.guideCertificate?.trim()) formData.set("GuideCertificate", input.guideCertificate.trim());
  if (input.origin?.trim()) formData.set("Origin", input.origin.trim());
  if (input.cattleCode?.trim()) formData.set("CattleCode", input.cattleCode.trim());
  if (input.deviceId?.trim()) formData.set("DeviceId", input.deviceId.trim());
  if (input.motherId?.trim()) formData.set("MotherId", input.motherId.trim());
  if (input.fatherId?.trim()) formData.set("FatherId", input.fatherId.trim());
  if (input.externalFatherEarTag?.trim()) formData.set("ExternalFatherEarTag", input.externalFatherEarTag.trim());
  if (input.externalFatherName?.trim()) formData.set("ExternalFatherName", input.externalFatherName.trim());
  if (input.externalMotherEarTag?.trim()) formData.set("ExternalMotherEarTag", input.externalMotherEarTag.trim());
  if (input.externalMotherName?.trim()) formData.set("ExternalMotherName", input.externalMotherName.trim());
  if (typeof input.cost === "number" && Number.isFinite(input.cost)) formData.set("Cost", String(input.cost));
  if (input.selfieFile) formData.set("selfie", input.selfieFile);

  return formData;
}

/** Plain summary of multipart fields (for tests and debugging; file shown as placeholder). */
export function summarizeAnimalCreateMultipart(input: IxorigueAnimalUpsertInput): Record<string, string> {
  const fd = mapCreateAnimalPayload(input);
  const out: Record<string, string> = {};
  fd.forEach((value, key) => {
    out[key] = value instanceof File ? `[File:${value.name ?? "binary"}]` : String(value);
  });
  return out;
}

export function mapUpdateAnimalPayload(input: IxorigueAnimalUpsertInput & { ixorigueAnimalId: string }) {
  const formData = mapCreateAnimalPayload(input);
  formData.set("Id", input.ixorigueAnimalId);
  if (input.deleteSelfie) {
    formData.set("DeleteSelfie", "true");
  }
  return formData;
}

export function mapAnimalWeightPayload(input: IxorigueAnimalWeightInput) {
  return {
    animalId: input.ixorigueAnimalId,
    // TODO: confirm preferred business tag taxonomy for weight events beyond the current defaults.
    tag: input.tag ?? "birth",
    date: input.measuredAt,
    weight: input.weight,
    title: input.title ?? "Weight update",
  };
}

function normalizeId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function mapRanchResponse(payload: unknown): IxorigueRanchDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  return {
    id: normalizeId(source.id) ?? normalizeId(source.ranchId) ?? "",
    externalId: normalizeId(source.externalId),
    name: typeof source.name === "string" ? source.name : null,
    code: typeof source.code === "string" ? source.code : null,
  };
}

export function mapRanchOverviewResponse(payload: unknown): IxorigueRanchOverviewDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  return {
    id: normalizeId(source.id) ?? normalizeId(source.ranchId) ?? "",
    name: typeof source.name === "string" ? source.name : null,
  };
}

export function mapRanchSettingsResponse(payload: unknown): IxorigueRanchSettingsDto {
  return unwrapData<Record<string, unknown>>(payload) ?? {};
}

function extractLotAnimalIds(source: Record<string, unknown>): string[] {
  const raw = source.animals;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const id = normalizeId(o.id) ?? normalizeId(o.animalId);
      if (id) out.push(id);
    }
  }
  return out;
}

export function mapLotResponse(payload: unknown): IxorigueLotDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  const zone = source.zone as Record<string, unknown> | undefined;
  const animalIds = extractLotAnimalIds(source);
  return {
    id: normalizeId(source.lotId) ?? normalizeId(source.id) ?? "",
    ranchId: normalizeId(source.ranchId),
    name: typeof source.name === "string" ? source.name : null,
    geometry: (source.geometry as IxorigueLotDto["geometry"]) ?? null,
    animalsCount: Array.isArray(source.animals) ? source.animals.length : null,
    animalIds,
    isFattening: typeof source.isFattening === "boolean" ? source.isFattening : null,
    color: typeof source.hexRgbColor === "string" ? source.hexRgbColor : null,
    zoneId: normalizeId(zone?.zoneId),
    zoneName: typeof zone?.name === "string" ? zone.name : null,
  };
}

export function mapAnimalResponse(payload: unknown): IxorigueAnimalDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  const coordinates = source.lastLocation as Record<string, unknown> | undefined;
  const lot = source.lot as Record<string, unknown> | undefined;
  const zone = source.zone as Record<string, unknown> | undefined;
  const lastWeight = source.lastWeight as Record<string, unknown> | undefined;
  const numericWeight =
    typeof lastWeight?.weight === "number"
      ? lastWeight.weight
      : typeof source.currentWeight === "number"
        ? source.currentWeight
        : typeof source.weight === "number"
          ? source.weight
          : null;

  return {
    id: normalizeId(source.id) ?? normalizeId(source.animalId) ?? "",
    ranchId: normalizeId(source.ranchId),
    lotId: normalizeId(lot?.lotId) ?? normalizeId(source.lotId),
    lotName: typeof lot?.name === "string" ? lot.name : null,
    name: typeof source.name === "string" ? source.name : null,
    earTag: typeof source.earTag === "string" ? source.earTag : null,
    sex: typeof source.sex === "string" ? source.sex : null,
    specie: typeof source.specie === "string" ? source.specie : null,
    race: typeof source.race === "string" ? source.race : null,
    isActive: typeof source.isActive === "boolean" ? source.isActive : null,
    currentWeight: numericWeight,
    lastWeight: lastWeight
      ? {
          id: normalizeId(lastWeight.id),
          weight: typeof lastWeight.weight === "number" ? lastWeight.weight : null,
          date: typeof lastWeight.date === "string" ? lastWeight.date : null,
        }
      : null,
    zoneId: normalizeId(zone?.zoneId),
    zoneName: typeof zone?.name === "string" ? zone.name : null,
    lotColor: typeof lot?.hexRgbColor === "string" ? lot.hexRgbColor : null,
    lotDisplayColor: typeof lot?.hexRgbColor === "string" ? lot.hexRgbColor : null,
    coordinates: coordinates && typeof coordinates.latitude === "number" && typeof coordinates.longitude === "number"
      ? {
          lat: coordinates.latitude,
          lng: coordinates.longitude,
          recordedAt: typeof source.lastLocationTimestamp === "string" ? source.lastLocationTimestamp : null,
        }
      : null,
  };
}

export function mapAnimalWeightResponse(payload: unknown): IxorigueAnimalWeightDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  return {
    id: normalizeId(source.id) ?? "",
    animalId: normalizeId(source.animalId),
    tag: typeof source.tag === "string" ? source.tag : null,
    title: typeof source.title === "string" ? source.title : null,
    date: typeof source.date === "string" ? source.date : null,
    weight: typeof source.weight === "number" ? source.weight : null,
  };
}

export function mapEarTagResponse(payload: unknown): IxorigueEarTagDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  return {
    ranchId: normalizeId(source.ranchId),
    earTag: typeof source.earTag === "string" ? source.earTag : "",
  };
}

export function mapDeviceResponse(payload: unknown): IxorigueDeviceDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  const animal = source.animal as Record<string, unknown> | undefined;

  return {
    id: normalizeId(source.id) ?? "",
    ranchId: normalizeId(source.ranchId),
    serialNumber: typeof source.serialNumber === "string" ? source.serialNumber : null,
    disabled: typeof source.disabled === "boolean" ? source.disabled : null,
    animalId: normalizeId(animal?.id),
    animalEarTag: typeof animal?.earTag === "string" ? animal.earTag : null,
    animalName: typeof animal?.name === "string" ? animal.name : null,
  };
}

export function mapMapDataResponse(payload: unknown): IxorigueMapDataDto {
  const source = unwrapData<Record<string, unknown>>(payload) ?? {};
  return {
    ranch: source.ranch ? mapRanchResponse(source.ranch) : null,
    lots: Array.isArray(source.lots) ? source.lots.map(mapLotResponse) : [],
    animals: Array.isArray(source.animals) ? source.animals.map(mapAnimalResponse) : [],
  };
}
