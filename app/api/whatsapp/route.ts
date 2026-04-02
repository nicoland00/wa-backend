import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { enqueueJob } from "@/lib/server/jobs";
import { uploadBufferToStorage } from "@/lib/storage";
import { downloadMedia, getMediaDownloadUrl, sendWhatsAppTextMessage, verifyMetaSignature } from "@/lib/wa/meta";
import { normalizePhone } from "@/lib/wa/phone";

export const runtime = "nodejs";

type WaMessage = {
  from?: string;
  id?: string;
  type?: string;
  document?: {
    id?: string;
    filename?: string;
    mime_type?: string;
  };
  text?: {
    body?: string;
  };
};

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

async function handleIncomingDocument(params: {
  fromPhone: string;
  waMessageId: string;
  mediaId: string;
  filename: string;
  mimeType: string | null;
}) {
  const db = await getDb();
  const normalizedPhone = normalizePhone(params.fromPhone);

  const user = await db.collection("users").findOne({ phoneE164: normalizedPhone, phoneStatus: "approved" });
  if (!user) {
    await sendWhatsAppTextMessage(normalizedPhone, "Please register and get approved.");
    return;
  }

  const mediaToken = process.env.WHATSAPP_TOKEN;
  if (!mediaToken) {
    throw new Error("Missing WHATSAPP_TOKEN");
  }

  const mediaMeta = await getMediaDownloadUrl(params.mediaId, mediaToken);
  const data = await downloadMedia(mediaMeta.url, mediaToken);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const stored = await uploadBufferToStorage({
    filename: params.filename || `${params.mediaId}.zip`,
    buffer: data,
    contentType: params.mimeType ?? mediaMeta.mime_type,
  });

  const now = new Date();
  const ranch = await db.collection("ranches").findOne({ ownerUserId: user._id });
  if (!ranch) {
    await sendWhatsAppTextMessage(normalizedPhone, "No ranch found. Contact admin.");
    return;
  }
  const importInsert = await db.collection("imports").insertOne({
    ranchId: ranch._id,
    farmId: ranch._id,
    lotId: null,
    source: "whatsapp_export",
    filename: params.filename,
    mimeType: params.mimeType,
    sizeBytes: data.byteLength,
    sha256,
    storage: stored,
    artifacts: [{ kind: "zip", key: stored.key, createdAt: now }],
    wa: { waMessageId: params.waMessageId, mediaId: params.mediaId, fromPhone: normalizedPhone },
    status: "awaiting_lot",
    error: null,
    createdAt: now,
    assignedAt: null,
    processedAt: null,
  });

  await db.collection("wa_sessions").updateOne(
    { phoneE164: normalizedPhone },
    {
      $set: {
        phoneE164: normalizedPhone,
        state: "AWAITING_LOT_SELECTION",
        pendingImportId: importInsert.insertedId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  const ranches = await db
    .collection("ranches")
    .find({ ownerUserId: user._id })
    .project({ _id: 1, name: 1 })
    .toArray();

  const lots = await db
    .collection("lots")
    .find({ ranchId: { $in: ranches.map((f) => f._id) } })
    .project({ _id: 1, name: 1, ranchId: 1 })
    .toArray();

  if (!lots.length) {
    await sendWhatsAppTextMessage(normalizedPhone, "No approved lots found. Contact admin.");
    return;
  }

  const lotList = lots.map((lot, index) => `${index + 1}. ${lot.name}`).join("\n");
  await sendWhatsAppTextMessage(normalizedPhone, `Import received. Reply with lot number:\n${lotList}`);
}

async function handleIncomingText(fromPhone: string, text: string) {
  const db = await getDb();
  const normalizedPhone = normalizePhone(fromPhone);

  const session = await db.collection("wa_sessions").findOne({ phoneE164: normalizedPhone, state: "AWAITING_LOT_SELECTION" });
  if (!session || !session.pendingImportId || session.expiresAt < new Date()) {
    return;
  }

  const user = await db.collection("users").findOne({ phoneE164: normalizedPhone, phoneStatus: "approved" });
  if (!user) {
    return;
  }

  const ranches = await db.collection("ranches").find({ ownerUserId: user._id }).project({ _id: 1 }).toArray();
  const lots = await db.collection("lots").find({ ranchId: { $in: ranches.map((f) => f._id) } }).toArray();

  let chosenLot = lots.find((lot) => lot.name.toLowerCase() === text.trim().toLowerCase()) ?? null;

  if (!chosenLot) {
    const index = Number(text.trim());
    if (!Number.isNaN(index) && index > 0 && index <= lots.length) {
      chosenLot = lots[index - 1];
    }
  }

  if (!chosenLot) {
    await sendWhatsAppTextMessage(normalizedPhone, "Could not resolve lot. Reply with exact lot name or number.");
    return;
  }

  await db.collection("imports").updateOne(
    { _id: session.pendingImportId },
    {
      $set: {
        lotId: chosenLot._id,
        ranchId: chosenLot.ranchId ?? chosenLot.farmId,
        farmId: chosenLot.ranchId ?? chosenLot.farmId,
        status: "assigned",
        assignedAt: new Date(),
      },
    },
  );

  await db.collection("wa_sessions").updateOne(
    { _id: session._id },
    {
      $set: {
        state: "IDLE",
        pendingImportId: null,
        updatedAt: new Date(),
      },
    },
  );

  await enqueueJob("process_import", { importId: session.pendingImportId.toString() });
  await sendWhatsAppTextMessage(normalizedPhone, `Import assigned to lot ${chosenLot.name}. Processing started.`);
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "Missing META_APP_SECRET" }, { status: 500 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyMetaSignature(raw, signature, appSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(raw) as {
    entry?: Array<{ changes?: Array<{ value?: { messages?: WaMessage[] } }> }>;
  };

  const messages = body.entry?.flatMap((entry) => entry.changes ?? []).flatMap((change) => change.value?.messages ?? []) ?? [];

  for (const message of messages) {
    const from = String(message.from ?? "");
    const messageId = String(message.id ?? "");
    const type = String(message.type ?? "");

    if (type === "document" && message.document?.id) {
      await handleIncomingDocument({
        fromPhone: from,
        waMessageId: messageId,
        mediaId: String(message.document.id),
        filename: String(message.document.filename ?? `${messageId}.zip`),
        mimeType: message.document.mime_type ? String(message.document.mime_type) : null,
      });
      continue;
    }

    if (type === "text" && message.text?.body) {
      await handleIncomingText(from, String(message.text.body));
    }
  }

  return NextResponse.json({ received: true });
}
