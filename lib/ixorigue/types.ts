export type IxorigueRequestOptions = {
  timeoutMs?: number;
  retries?: number;
};

export type IxorigueRanchSettingsInput = {
  // TODO: confirm exact Ranch settings payload keys against live swagger.json
  name?: string;
};

export type IxorigueLotUpsertInput = {
  localLotId: string;
  ixorigueRanchId: string;
  name: string;
  geometry?: { type: "Polygon"; coordinates: number[][][] } | null;
  /** Ixorigue animal IDs to assign to the lot. Create uses this; ranchId is in path. */
  animals?: string[];
  isFattening?: boolean;
  zoneId?: string;
  hexRgbColor?: string;
};

export type IxorigueAnimalUpsertInput = {
  localAnimalId: string;
  ixorigueRanchId: string;
  ixorigueAnimalId?: string;
  ixorigueLotId: string;
  earTagNumber: string;
  specie: string;
  sex: string;
  breed?: string;
  name?: string;
  description?: string;
  guideCertificate?: string;
  origin?: string;
  cattleCode?: string;
  registerReason?: string;
  birthDate?: string;
  dateOfPurchase?: string;
  deviceId?: string;
  motherId?: string;
  fatherId?: string;
  externalFatherEarTag?: string;
  externalFatherName?: string;
  externalMotherEarTag?: string;
  externalMotherName?: string;
  cost?: number;
  selfieFile?: File | null;
  deleteSelfie?: boolean;
};

export type IxorigueAnimalWeightInput = {
  ixorigueRanchId: string;
  ixorigueAnimalId: string;
  ixorigueWeightId?: string;
  weight: number;
  measuredAt: string;
  tag?: string;
  title?: string;
};

export type IxorigueEarTagDto = {
  ranchId?: string | null;
  earTag: string;
};

export type IxorigueDeviceDto = {
  id: string;
  ranchId?: string | null;
  serialNumber?: string | null;
  disabled?: boolean | null;
  animalId?: string | null;
  animalEarTag?: string | null;
  animalName?: string | null;
};

export type IxorigueRanchDto = {
  id: string;
  externalId?: string | null;
  name?: string | null;
  code?: string | null;
};

export type IxorigueRanchOverviewDto = {
  id: string;
  name?: string | null;
};

export type IxorigueRanchPlanningDto = Record<string, unknown>;
export type IxorigueRanchProductionDto = Record<string, unknown>;
export type IxorigueRanchProfitsDto = Record<string, unknown>;
export type IxorigueRanchSettingsDto = Record<string, unknown>;

export type IxorigueLotDto = {
  id: string;
  ranchId?: string | null;
  name?: string | null;
  geometry?: { type: "Polygon"; coordinates: number[][][] } | null;
  animalsCount?: number | null;
  /** Animal GUIDs currently on the lot (from `data.animals`). */
  animalIds?: string[];
  isFattening?: boolean | null;
  color?: string | null;
  zoneId?: string | null;
  zoneName?: string | null;
};

export type IxorigueAnimalLastWeightDto = {
  id?: string | null;
  weight?: number | null;
  date?: string | null;
};

export type IxorigueAnimalLocationDto = {
  lat: number;
  lng: number;
  recordedAt?: string | null;
};

export type IxorigueAnimalDto = {
  id: string;
  ranchId?: string | null;
  lotId?: string | null;
  lotName?: string | null;
  lotDisplayColor?: string | null;
  name?: string | null;
  earTag?: string | null;
  sex?: string | null;
  specie?: string | null;
  race?: string | null;
  isActive?: boolean | null;
  currentWeight?: number | null;
  coordinates?: IxorigueAnimalLocationDto | null;
  lastWeight?: IxorigueAnimalLastWeightDto | null;
  zoneId?: string | null;
  zoneName?: string | null;
  lotColor?: string | null;
};

export type IxorigueAnimalWeightDto = {
  id: string;
  animalId?: string | null;
  tag?: string | null;
  title?: string | null;
  date?: string | null;
  weight?: number | null;
};

export type IxorigueAnimalPathPointDto = {
  lat: number;
  lng: number;
  recordedAt?: string | null;
};

export type IxorigueMapDataDto = {
  ranch?: IxorigueRanchDto | null;
  lots?: IxorigueLotDto[];
  animals?: IxorigueAnimalDto[];
};
