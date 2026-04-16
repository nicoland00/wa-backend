import { ObjectId } from "mongodb";

export type Role = "admin" | "institutional" | "retail";
export type StoredRole = Role | "user";
export type PhoneStatus = "none" | "pending" | "approved" | "rejected";
export type ImportStatus = "received" | "stored" | "awaiting_lot" | "assigned" | "processing" | "processed" | "failed";
export type SyncStatus = "pending" | "synced" | "failed";
export type LifeStatus = "alive" | "dead";
export type DataErrorStatus = "open" | "resolved" | "rejected";
export type SyncEntityType = "ranch" | "lot" | "animal" | "animal_weight";
export type SyncJobAction = "link" | "create" | "update" | "weight" | "sync_pull";

export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

export type StoredMediaRef = {
  provider: "r2" | "s3" | "vercel_blob" | "local" | "gridfs";
  bucket?: string;
  key: string;
  url?: string;
};

export type UserDoc = {
  _id: ObjectId;
  email: string;
  name: string | null;
  role: StoredRole;
  phoneE164: string | null;
  phoneStatus: PhoneStatus;
  ixorigueUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RanchDoc = {
  _id: ObjectId;
  ownerUserId: ObjectId;
  name: string;
  ixorigueRanchId: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  createdByAdminUserId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type FarmDoc = RanchDoc;

export type LotDoc = {
  _id: ObjectId;
  ranchId: ObjectId;
  // Deprecated legacy alias still present in some old documents/routes.
  farmId?: ObjectId;
  name: string;
  ixorigueLotId: string | null;
  geometry: GeoJsonPolygon | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  createdByAdminUserId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type AnimalDoc = {
  _id: ObjectId;
  ranchId: ObjectId;
  // Deprecated legacy alias still present in some old documents/routes.
  farmId?: ObjectId;
  lotId: ObjectId;
  ixorigueAnimalId: string | null;
  specie?: string | null;
  sex: string;
  breed: string;
  color: string;
  brandNumber: string;
  earTagNumber: string;
  deviceId?: string | null;
  registerReason?: string | null;
  birthDate?: Date | null;
  dateOfPurchase?: Date | null;
  initialWeight: number;
  currentWeight: number;
  lifeStatus: LifeStatus;
  photoStorageKey: string;
  photoStorageProvider?: StoredMediaRef["provider"];
  photoStorageBucket?: string | null;
  photoStorageUrl?: string | null;
  videoStorageKey?: string | null;
  videoStorageProvider?: StoredMediaRef["provider"] | null;
  videoStorageBucket?: string | null;
  videoStorageUrl?: string | null;
  lastKnownCoordinates?: { lat: number; lng: number; recordedAt: Date } | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  createdByAdminUserId: ObjectId;
  // Deprecated legacy aliases.
  tag?: string | null;
  name?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AnimalWeightDoc = {
  _id: ObjectId;
  animalId: ObjectId;
  ixorigueWeightId?: string | null;
  weight: number;
  measuredAt: Date;
  source: "user" | "admin" | "ixorigue_sync";
  syncStatus: SyncStatus;
  syncError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportDoc = {
  _id: ObjectId;
  ranchId: ObjectId;
  // Deprecated legacy alias still present in some old documents/routes.
  farmId?: ObjectId;
  lotId: ObjectId | null;
  source: "whatsapp_export" | "manual_upload";
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  storage: {
    provider: "r2" | "s3" | "vercel_blob" | "local" | "gridfs";
    bucket?: string;
    key: string;
    url?: string;
  };
  artifacts: Array<{ kind: "zip" | "txt" | "messages_json"; key: string; createdAt: Date }>;
  wa?: { waMessageId?: string; mediaId?: string; fromPhone?: string };
  status: ImportStatus;
  error: string | null;
  createdAt: Date;
  assignedAt: Date | null;
  processedAt: Date | null;
  updatedAt?: Date;
};

export type WaSessionDoc = {
  _id: ObjectId;
  phoneE164: string;
  state: "IDLE" | "AWAITING_LOT_SELECTION";
  pendingImportId: ObjectId | null;
  expiresAt: Date;
  updatedAt: Date;
};

export type AuditLogDoc = {
  _id: ObjectId;
  actorUserId: ObjectId;
  actorRole: Role;
  action: string;
  target: { type: string; id: string };
  before?: unknown;
  after?: unknown;
  createdAt: Date;
};

export type SyncJobDoc = {
  _id: ObjectId;
  entityType: SyncEntityType;
  entityId: ObjectId;
  action: SyncJobAction;
  provider: "ixorigue";
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobDoc = {
  _id: ObjectId;
  type: string;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  runAt: Date;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type IntegrationCredentialDoc = {
  _id: ObjectId;
  key: "ixorigue";
  encryptedRefreshToken: string | null;
  tokenUrl: string | null;
  clientId: string | null;
  lastRefreshAttemptAt?: Date | null;
  lastRefreshSucceededAt?: Date | null;
  lastRefreshError?: string | null;
  updatedAt: Date;
  updatedByUserId: ObjectId;
};

export type DataErrorRequestDoc = {
  _id: ObjectId;
  ranchId?: ObjectId | null;
  lotId?: ObjectId | null;
  animalId?: ObjectId | null;
  reportedByUserId: ObjectId;
  message: string;
  status: DataErrorStatus;
  resolvedByAdminUserId?: ObjectId | null;
  createdAt: Date;
  resolvedAt?: Date | null;
};
