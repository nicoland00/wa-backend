import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { inferIxorigueRefreshTokenMetadata } from "@/lib/ixorigue/auth";
import type { IntegrationCredentialDoc } from "@/lib/db/types";

export type ResolvedIxorigueRefreshTokenConfig = {
  source: "database" | "environment";
  refreshToken: string;
  clientId: string;
  tokenUrl: string | null;
};

function getEncryptionKey() {
  const secret = process.env.IXORIGUE_CREDENTIALS_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("Missing IXORIGUE_CREDENTIALS_SECRET, AUTH_SECRET, or NEXTAUTH_SECRET for Ixorigue credential encryption.");
  }

  return createHash("sha256").update(secret).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSecret(payload: string) {
  const [version, ivEncoded, tagEncoded, encryptedEncoded] = payload.split(":");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !encryptedEncoded) {
    throw new Error("Unsupported encrypted credential format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function maskSecret(secret: string) {
  if (secret.length <= 8) {
    return `••••${secret.slice(-2)}`;
  }

  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

async function getIxorigueCredentialDoc() {
  const db = await getDb();
  return db.collection<IntegrationCredentialDoc>("integration_credentials").findOne({ key: "ixorigue" });
}

function getEnvironmentCredential(): ResolvedIxorigueRefreshTokenConfig | null {
  const refreshToken = process.env.IXORIGUE_REFRESH_TOKEN;
  if (!refreshToken) {
    return null;
  }

  const inferred = inferIxorigueRefreshTokenMetadata(refreshToken);
  return {
    source: "environment",
    refreshToken,
    clientId: process.env.IXORIGUE_CLIENT_ID || inferred.clientId,
    tokenUrl: process.env.IXORIGUE_TOKEN_URL || inferred.tokenUrl,
  };
}

export async function resolveIxorigueRefreshTokenConfig(): Promise<ResolvedIxorigueRefreshTokenConfig | null> {
  const doc = await getIxorigueCredentialDoc();
  if (doc?.encryptedRefreshToken) {
    const refreshToken = decryptSecret(doc.encryptedRefreshToken);
    const inferred = inferIxorigueRefreshTokenMetadata(refreshToken);

    return {
      source: "database",
      refreshToken,
      clientId: doc.clientId || inferred.clientId,
      tokenUrl: doc.tokenUrl || inferred.tokenUrl,
    };
  }

  return getEnvironmentCredential();
}

export async function getIxorigueCredentialStatus() {
  const doc = await getIxorigueCredentialDoc();
  const envCredential = getEnvironmentCredential();

  let maskedRefreshToken: string | null = null;
  let source: "database" | "environment" | "missing" = "missing";
  let clientId: string | null = null;
  let tokenUrl: string | null = null;

  if (doc?.encryptedRefreshToken) {
    const decrypted = decryptSecret(doc.encryptedRefreshToken);
    const inferred = inferIxorigueRefreshTokenMetadata(decrypted);
    maskedRefreshToken = maskSecret(decrypted);
    source = "database";
    clientId = doc.clientId || inferred.clientId;
    tokenUrl = doc.tokenUrl || inferred.tokenUrl;
  } else if (envCredential) {
    maskedRefreshToken = maskSecret(envCredential.refreshToken);
    source = "environment";
    clientId = envCredential.clientId;
    tokenUrl = envCredential.tokenUrl;
  }

  return {
    source,
    hasDatabaseCredential: Boolean(doc?.encryptedRefreshToken),
    hasEnvironmentCredential: Boolean(envCredential),
    maskedRefreshToken,
    clientId,
    tokenUrl,
    updatedAt: doc?.updatedAt?.toISOString() ?? null,
    updatedByUserId: doc?.updatedByUserId?.toString() ?? null,
    lastRefreshAttemptAt: doc?.lastRefreshAttemptAt?.toISOString() ?? null,
    lastRefreshSucceededAt: doc?.lastRefreshSucceededAt?.toISOString() ?? null,
    lastRefreshError: doc?.lastRefreshError ?? null,
  };
}

export async function upsertIxorigueCredential(input: {
  refreshToken: string;
  clientId?: string | null;
  tokenUrl?: string | null;
  updatedByUserId: string;
}) {
  const db = await getDb();
  const inferred = inferIxorigueRefreshTokenMetadata(input.refreshToken);

  await db.collection<IntegrationCredentialDoc>("integration_credentials").updateOne(
    { key: "ixorigue" },
    {
      $set: {
        key: "ixorigue",
        encryptedRefreshToken: encryptSecret(input.refreshToken),
        clientId: input.clientId?.trim() || inferred.clientId,
        tokenUrl: input.tokenUrl?.trim() || inferred.tokenUrl,
        updatedAt: new Date(),
        updatedByUserId: new ObjectId(input.updatedByUserId),
      },
      $setOnInsert: {
        lastRefreshAttemptAt: null,
        lastRefreshSucceededAt: null,
        lastRefreshError: null,
      },
    },
    { upsert: true },
  );

  return getIxorigueCredentialStatus();
}

export async function recordIxorigueCredentialRefreshResult(input: {
  source: "database" | "environment";
  ok: boolean;
  error?: string | null;
}) {
  if (input.source !== "database") {
    return;
  }

  const db = await getDb();
  const now = new Date();

  await db.collection<IntegrationCredentialDoc>("integration_credentials").updateOne(
    { key: "ixorigue" },
    {
      $set: {
        lastRefreshAttemptAt: now,
        lastRefreshSucceededAt: input.ok ? now : null,
        lastRefreshError: input.ok ? null : input.error ?? "Unknown Ixorigue refresh error",
      },
    },
  );
}

