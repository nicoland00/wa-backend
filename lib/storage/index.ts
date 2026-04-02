import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type StoredFileRef = {
  provider: "r2" | "s3" | "vercel_blob" | "local" | "gridfs";
  bucket?: string;
  key: string;
  url?: string;
};

async function loadAwsSdk() {
  const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
  const s3 = (await dynamicImport("@aws-sdk/client-s3")) as {
    S3Client: new (params: Record<string, unknown>) => {
      send: (command: unknown) => Promise<unknown>;
    };
    PutObjectCommand: new (params: Record<string, unknown>) => unknown;
    GetObjectCommand: new (params: Record<string, unknown>) => unknown;
  };
  const presigner = (await dynamicImport("@aws-sdk/s3-request-presigner")) as {
    getSignedUrl: (client: unknown, command: unknown, params: { expiresIn: number }) => Promise<string>;
  };
  return { s3, presigner };
}

export async function uploadBufferToStorage(params: {
  filename: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<StoredFileRef> {
  const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${params.filename}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    const { put } = (await dynamicImport("@vercel/blob")) as {
      put: (
        key: string,
        body: Buffer,
        params: { access: "private"; token: string; contentType?: string },
      ) => Promise<{ url: string }>;
    };

    const blob = await put(key, params.buffer, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: params.contentType,
    });

    return { provider: "vercel_blob", key, url: blob.url };
  }

  if (process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    const { s3 } = await loadAwsSdk();
    const client = new s3.S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });

    await client.send(
      new s3.PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: params.buffer,
        ContentType: params.contentType,
      }),
    );

    const provider = process.env.S3_PROVIDER === "r2" ? "r2" : "s3";
    return { provider, bucket: process.env.S3_BUCKET, key };
  }

  const baseDir = process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), "tmp-storage");
  const absolutePath = path.join(baseDir, key);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, params.buffer);

  return { provider: "local", key, url: `/api/storage/local/${encodeURIComponent(key)}` };
}

export async function getSignedDownloadUrl(storage: StoredFileRef): Promise<string | null> {
  if (storage.provider === "vercel_blob") {
    return storage.url ?? null;
  }

  if ((storage.provider === "s3" || storage.provider === "r2") && storage.bucket && process.env.S3_ENDPOINT) {
    const { s3, presigner } = await loadAwsSdk();
    const client = new s3.S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      },
    });

    return presigner.getSignedUrl(
      client,
      new s3.GetObjectCommand({
        Bucket: storage.bucket,
        Key: storage.key,
      }),
      { expiresIn: 300 },
    );
  }

  if (storage.provider === "local") {
    return `/api/storage/local/${encodeURIComponent(storage.key)}`;
  }

  return null;
}
