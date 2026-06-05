import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { objectIdSchema } from "@/lib/validators/common";
import type { AnimalDoc, ImportDoc } from "@/lib/db/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid import id" }, { status: 400 });

  const body = (await request.json()) as { animalId?: string };
  if (!body.animalId || !ObjectId.isValid(body.animalId)) {
    return NextResponse.json({ error: "Invalid animalId" }, { status: 400 });
  }

  const db = await getDb();
  const importDoc = await db.collection<ImportDoc>("imports").findOne({ _id: new ObjectId(parsedId.data) });
  if (!importDoc) return NextResponse.json({ error: "Import not found" }, { status: 404 });

  const animal = await db.collection<AnimalDoc>("animals").findOne({ _id: new ObjectId(body.animalId) });
  if (!animal) return NextResponse.json({ error: "Animal not found" }, { status: 404 });

  const now = new Date();

  await db.collection<ImportDoc>("imports").updateOne(
    { _id: new ObjectId(parsedId.data) },
    { $set: { animalId: new ObjectId(body.animalId), updatedAt: now } },
  );

  await db.collection<AnimalDoc>("animals").updateOne(
    { _id: new ObjectId(body.animalId) },
    {
      $set: {
        videoStorageKey: importDoc.storage.key,
        videoStorageProvider: importDoc.storage.provider,
        videoStorageBucket: importDoc.storage.bucket ?? null,
        videoStorageUrl: importDoc.storage.url ?? null,
        updatedAt: now,
      },
    },
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid import id" }, { status: 400 });

  const db = await getDb();
  const importDoc = await db.collection<ImportDoc>("imports").findOne({ _id: new ObjectId(parsedId.data) });
  if (!importDoc) return NextResponse.json({ error: "Import not found" }, { status: 404 });

  const now = new Date();
  await db.collection<ImportDoc>("imports").updateOne(
    { _id: new ObjectId(parsedId.data) },
    { $set: { animalId: null, updatedAt: now } },
  );

  if (importDoc.animalId) {
    await db.collection<AnimalDoc>("animals").updateOne(
      { _id: importDoc.animalId },
      {
        $set: {
          videoStorageKey: null,
          videoStorageProvider: null,
          videoStorageBucket: null,
          videoStorageUrl: null,
          updatedAt: now,
        },
      },
    );
  }

  return NextResponse.json({ ok: true });
}
