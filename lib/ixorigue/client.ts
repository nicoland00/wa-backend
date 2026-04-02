import {
  mapAnimalResponse,
  mapAnimalWeightResponse,
  mapAnimalWeightPayload,
  mapCreateAnimalPayload,
  mapCreateLotPayload,
  mapDeviceResponse,
  mapEarTagResponse,
  mapLotResponse,
  mapRanchResponse,
  mapRanchOverviewResponse,
  mapRanchSettingsResponse,
  mapUpdateAnimalPayload,
  mapUpdateLotPayload,
  mapUpdateRanchSettingsPayload,
} from "@/lib/ixorigue/mappers";
import type {
  IxorigueAnimalPathPointDto,
  IxorigueAnimalUpsertInput,
  IxorigueAnimalWeightDto,
  IxorigueAnimalWeightInput,
  IxorigueDeviceDto,
  IxorigueEarTagDto,
  IxorigueLotUpsertInput,
  IxorigueRanchPlanningDto,
  IxorigueRanchProductionDto,
  IxorigueRanchProfitsDto,
  IxorigueRequestOptions,
  IxorigueRanchSettingsDto,
  IxorigueRanchSettingsInput,
} from "@/lib/ixorigue/types";

const endpointPaths = {
  ranches: "/api/Ranches",
  ranchOverview: (ranchId: string) => `/api/Ranches/${ranchId}/overview`,
  ranchPlanning: (ranchId: string) => `/api/Ranches/${ranchId}/planning`,
  ranchProduction: (ranchId: string) => `/api/Ranches/${ranchId}/production`,
  ranchProfits: (ranchId: string) => `/api/Ranches/${ranchId}/profits`,
  ranchSettings: (ranchId: string) => `/api/Ranches/${ranchId}/settings`,
  animalsLotsByRanch: (ranchId: string) => `/api/AnimalsLots/${ranchId}`,
  animalsLotById: (ranchId: string, lotId: string) => `/api/AnimalsLots/${ranchId}/${lotId}`,
  animalsLotUsage: (ranchId: string, lotId: string) => `/api/AnimalsLots/${ranchId}/${lotId}/usage`,
  animalsLotZoneLogs: (ranchId: string, lotId: string) => `/api/AnimalsLots/${ranchId}/${lotId}/zone-logs`,
  animalsLotActivity: (ranchId: string, lotId: string) => `/api/AnimalsLots/${ranchId}/${lotId}/activity`,
  // TODO: confirm exact Animals Swagger endpoint paths
  animalsByRanch: (ranchId: string) => `/api/Animals/${ranchId}`,
  animalById: (ranchId: string, animalId: string) => `/api/Animals/${ranchId}/${animalId}`,
  animalWeights: (ranchId: string) => `/api/Animals/${ranchId}/weights`,
  animalWeightById: (ranchId: string, weightId: string) => `/api/Animals/${ranchId}/weights/${weightId}`,
  animalPath: (ranchId: string, animalId: string, date: string) => `/api/Animals/${ranchId}/${animalId}/path?date=${encodeURIComponent(date)}`,
  animalEarTagsByRanch: (ranchId: string) => `/api/AnimalsEarTags/${ranchId}`,
  devicesByRanch: (ranchId: string) => `/api/Devices/${ranchId}`,
} as const;

function getBaseUrl() {
  const baseUrl = process.env.IXORIGUE_BASE_URL || process.env.IXORIGUE_API_URL;
  if (!baseUrl) {
    throw new Error("Missing IXORIGUE_BASE_URL or IXORIGUE_API_URL");
  }
  return baseUrl.replace(/\/+$/, "");
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT structure");
  }

  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const json = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

function getRefreshTokenConfig() {
  const refreshToken = process.env.IXORIGUE_REFRESH_TOKEN;
  if (!refreshToken) {
    return null;
  }

  const payload = decodeJwtPayload(refreshToken);
  const issuer = typeof payload.iss === "string" ? payload.iss.replace(/\/+$/, "") : null;
  const clientId = typeof payload.azp === "string" ? payload.azp : process.env.IXORIGUE_CLIENT_ID || "platform";

  return {
    refreshToken,
    clientId,
    tokenUrl: process.env.IXORIGUE_TOKEN_URL || (issuer ? `${issuer}/protocol/openid-connect/token` : null),
  };
}

let accessTokenCache: { token: string; expiresAt: number } | null = null;
let tokenPromise: Promise<string> | null = null;

async function getAccessTokenFromRefreshToken() {
  const config = getRefreshTokenConfig();
  if (!config?.tokenUrl) {
    throw new Error("Missing IXORIGUE_TOKEN_URL and could not infer token endpoint from IXORIGUE_REFRESH_TOKEN");
  }
  const tokenUrl = config.tokenUrl;

  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 30_000) {
    return accessTokenCache.token;
  }

  if (!tokenPromise) {
    tokenPromise = (async () => {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: config.refreshToken,
        client_id: process.env.IXORIGUE_CLIENT_ID || config.clientId,
      });

      if (process.env.IXORIGUE_CLIENT_SECRET) {
        body.set("client_secret", process.env.IXORIGUE_CLIENT_SECRET);
      }

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      });

      const raw = await response.text();
      const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (!response.ok || typeof data.access_token !== "string") {
        const message = typeof data.error_description === "string"
          ? data.error_description
          : typeof data.error === "string"
            ? data.error
            : `${response.status} ${response.statusText}`;
        throw new Error(`Ixorigue token refresh failed: ${message}`);
      }

      const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 300;
      accessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      return data.access_token;
    })().finally(() => {
      tokenPromise = null;
    });
  }

  return tokenPromise;
}

async function getHeaders(includeJsonContentType = true) {
  const token = process.env.IXORIGUE_AUTH_TOKEN || (process.env.IXORIGUE_REFRESH_TOKEN ? await getAccessTokenFromRefreshToken() : null);
  const apiKey = process.env.IXORIGUE_API_KEY;

  if (!token && !apiKey) {
    throw new Error("Missing IXORIGUE_AUTH_TOKEN, IXORIGUE_REFRESH_TOKEN, or IXORIGUE_API_KEY");
  }

  return {
    Accept: "application/json",
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, init: RequestInit = {}, options: IxorigueRequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 1;
  const url = `${getBaseUrl()}${path}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const includeJsonContentType = !(typeof FormData !== "undefined" && init.body instanceof FormData);

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...(await getHeaders(includeJsonContentType)),
          ...(init.headers ?? {}),
        },
        cache: "no-store",
        signal: controller.signal,
      });

      const raw = await response.text();
      const data = raw ? (JSON.parse(raw) as unknown) : null;

      if (!response.ok) {
        const errDesc = typeof data === "object" && data && data !== null && "errorDescription" in data
          ? (data as { errorDescription?: { message?: string; details?: string } }).errorDescription
          : null;
        let message =
          typeof errDesc?.message === "string"
            ? errDesc.message
            : typeof data === "object" && data && "message" in data && typeof (data as { message: string }).message === "string"
              ? (data as { message: string }).message
              : `${response.status} ${response.statusText}`;
        if (typeof errDesc?.details === "string" && errDesc.details.trim()) {
          message += ` — ${errDesc.details}`;
        } else if (Array.isArray(errDesc?.details) && errDesc.details.length) {
          message += ` — ${errDesc.details.map((item) => String(item)).join("; ")}`;
        }
        if (process.env.NODE_ENV !== "production" && typeof data === "object" && data !== null) {
          console.error("[Ixorigue] Validation/error response:", JSON.stringify(data, null, 2));
        }
        throw new Error(`Ixorigue request failed for ${path}: ${message}`);
      }

      return data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const transient = lastError.name === "AbortError" || /50\d/.test(lastError.message);

      if (!transient || attempt === retries) {
        throw lastError;
      }

      await sleep((attempt + 1) * 500);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Ixorigue request failed for ${path}`);
}

function pickCreatedEntity(payload: unknown) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function pickDataArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object" && "data" in payload && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return [];
}

export async function getRanches() {
  const payload = await request<unknown>(endpointPaths.ranches);
  return pickDataArray(payload).map(mapRanchResponse);
}

export async function getRanchOverview(ixorigueRanchId: string) {
  const payload = await request(endpointPaths.ranchOverview(ixorigueRanchId));
  return mapRanchOverviewResponse(pickCreatedEntity(payload));
}

export async function getRanchPlanning(ixorigueRanchId: string): Promise<IxorigueRanchPlanningDto> {
  return request(endpointPaths.ranchPlanning(ixorigueRanchId));
}

export async function getRanchProduction(ixorigueRanchId: string): Promise<IxorigueRanchProductionDto> {
  return request(endpointPaths.ranchProduction(ixorigueRanchId));
}

export async function getRanchProfits(ixorigueRanchId: string): Promise<IxorigueRanchProfitsDto> {
  return request(endpointPaths.ranchProfits(ixorigueRanchId));
}

export async function getRanchSettings(ixorigueRanchId: string): Promise<IxorigueRanchSettingsDto> {
  const payload = await request(endpointPaths.ranchSettings(ixorigueRanchId));
  return mapRanchSettingsResponse(payload);
}

export async function updateRanchSettings(ixorigueRanchId: string, input: IxorigueRanchSettingsInput) {
  const payload = await request(endpointPaths.ranchSettings(ixorigueRanchId), {
    method: "PUT",
    body: JSON.stringify(mapUpdateRanchSettingsPayload(input)),
  });
  return mapRanchSettingsResponse(payload);
}

export async function createLot(ixorigueRanchId: string, input: IxorigueLotUpsertInput) {
  const payload = await request(endpointPaths.animalsLotsByRanch(ixorigueRanchId), {
    method: "POST",
    body: JSON.stringify(mapCreateLotPayload(input)),
  });
  return mapLotResponse(pickCreatedEntity(payload));
}

export async function updateLot(ixorigueRanchId: string, input: IxorigueLotUpsertInput & { ixorigueLotId: string }) {
  const payload = await request(endpointPaths.animalsLotsByRanch(ixorigueRanchId), {
    method: "PUT",
    body: JSON.stringify(mapUpdateLotPayload(input)),
  });
  return mapLotResponse(pickCreatedEntity(payload));
}

export async function getLotById(ixorigueRanchId: string, ixorigueLotId: string) {
  const payload = await request(endpointPaths.animalsLotById(ixorigueRanchId, ixorigueLotId));
  return mapLotResponse(pickCreatedEntity(payload));
}

export async function deleteLot(ixorigueRanchId: string, ixorigueLotId: string) {
  return request(endpointPaths.animalsLotById(ixorigueRanchId, ixorigueLotId), { method: "DELETE" });
}

export async function getLotUsage(ixorigueRanchId: string, ixorigueLotId: string) {
  return request(endpointPaths.animalsLotUsage(ixorigueRanchId, ixorigueLotId));
}

export async function getLotZoneLogs(ixorigueRanchId: string, ixorigueLotId: string) {
  return request(endpointPaths.animalsLotZoneLogs(ixorigueRanchId, ixorigueLotId));
}

export async function getLotActivity(ixorigueRanchId: string, ixorigueLotId: string) {
  return request(endpointPaths.animalsLotActivity(ixorigueRanchId, ixorigueLotId));
}

export async function createAnimal(input: IxorigueAnimalUpsertInput) {
  const body = mapCreateAnimalPayload(input);
  const payload = await request(endpointPaths.animalsByRanch(input.ixorigueRanchId), {
    method: "POST",
    body,
  });
  return mapAnimalResponse(pickCreatedEntity(payload));
}

export async function updateAnimal(input: IxorigueAnimalUpsertInput & { ixorigueAnimalId: string }) {
  const body = mapUpdateAnimalPayload(input);
  const payload = await request(endpointPaths.animalsByRanch(input.ixorigueRanchId), {
    method: "PUT",
    body,
  });
  return mapAnimalResponse(pickCreatedEntity(payload));
}

export async function addAnimalWeight(input: IxorigueAnimalWeightInput) {
  const payload = await request(endpointPaths.animalWeights(input.ixorigueRanchId), {
    method: "POST",
    body: JSON.stringify(mapAnimalWeightPayload(input)),
  });
  return mapAnimalWeightResponse(pickCreatedEntity(payload));
}

export async function updateAnimalWeight(input: IxorigueAnimalWeightInput & { ixorigueWeightId: string }) {
  const payload = await request(endpointPaths.animalWeightById(input.ixorigueRanchId, input.ixorigueWeightId), {
    method: "PUT",
    body: JSON.stringify(mapAnimalWeightPayload(input)),
  });
  return mapAnimalWeightResponse(pickCreatedEntity(payload));
}

export async function getAnimalWeights(ixorigueRanchId: string, ixorigueAnimalId: string): Promise<IxorigueAnimalWeightDto[]> {
  const payload = await request<unknown>(`${endpointPaths.animalWeights(ixorigueRanchId)}?animalId=${encodeURIComponent(ixorigueAnimalId)}`);
  return pickDataArray(payload).map(mapAnimalWeightResponse);
}

export async function getLotsByRanch(ixorigueRanchId: string) {
  const payload = await request<unknown>(endpointPaths.animalsLotsByRanch(ixorigueRanchId));
  return pickDataArray(payload).map(mapLotResponse);
}

export async function getAnimalsByRanch(ixorigueRanchId: string) {
  const payload = await request<unknown>(endpointPaths.animalsByRanch(ixorigueRanchId));
  return pickDataArray(payload).map(mapAnimalResponse);
}

export async function getAnimalById(ixorigueRanchId: string, ixorigueAnimalId: string) {
  const payload = await request(endpointPaths.animalById(ixorigueRanchId, ixorigueAnimalId));
  return mapAnimalResponse(pickCreatedEntity(payload));
}

export async function getAnimalEarTags(ixorigueRanchId: string): Promise<IxorigueEarTagDto[]> {
  const payload = await request<unknown>(endpointPaths.animalEarTagsByRanch(ixorigueRanchId));
  return pickDataArray(payload).map(mapEarTagResponse).filter((item) => item.earTag);
}

export async function getDevicesByRanch(ixorigueRanchId: string): Promise<IxorigueDeviceDto[]> {
  const payload = await request<unknown>(endpointPaths.devicesByRanch(ixorigueRanchId));
  return pickDataArray(payload).map(mapDeviceResponse).filter((item) => item.id);
}

export async function getAnimalPath(ixorigueRanchId: string, ixorigueAnimalId: string, date: string): Promise<IxorigueAnimalPathPointDto[]> {
  return request(endpointPaths.animalPath(ixorigueRanchId, ixorigueAnimalId, date));
}

/** DELETE /api/Animals/{ranchId}/{animalId} */
export async function deleteAnimal(ixorigueRanchId: string, ixorigueAnimalId: string): Promise<void> {
  await request(endpointPaths.animalById(ixorigueRanchId, ixorigueAnimalId), { method: "DELETE" });
}
