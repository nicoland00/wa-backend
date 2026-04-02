import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { createDataErrorRequestSchema } from "@/lib/validators/data-error-requests";

export async function POST(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createDataErrorRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  if (parsed.data.ranchId) {
    const ranch = await db.collection("ranches").findOne({ _id: new ObjectId(parsed.data.ranchId), ownerUserId: new ObjectId(user.userId) });
    if (!ranch) {
      return NextResponse.json({ error: "Forbidden ranch reference" }, { status: 403 });
    }
  }

  if (parsed.data.lotId) {
    const lot = await db.collection("lots").findOne({ _id: new ObjectId(parsed.data.lotId) });
    const ranch = lot ? await db.collection("ranches").findOne({ _id: lot.ranchId, ownerUserId: new ObjectId(user.userId) }) : null;
    if (!lot || !ranch) {
      return NextResponse.json({ error: "Forbidden lot reference" }, { status: 403 });
    }
  }

  if (parsed.data.animalId) {
    const animal = await db.collection("animals").findOne({ _id: new ObjectId(parsed.data.animalId) });
    const ranch = animal ? await db.collection("ranches").findOne({ _id: animal.ranchId, ownerUserId: new ObjectId(user.userId) }) : null;
    if (!animal || !ranch) {
      return NextResponse.json({ error: "Forbidden animal reference" }, { status: 403 });
    }
  }

  const now = new Date();
  const result = await db.collection("data_error_requests").insertOne({
    ranchId: parsed.data.ranchId ? new ObjectId(parsed.data.ranchId) : null,
    lotId: parsed.data.lotId ? new ObjectId(parsed.data.lotId) : null,
    animalId: parsed.data.animalId ? new ObjectId(parsed.data.animalId) : null,
    reportedByUserId: new ObjectId(user.userId),
    message: parsed.data.message,
    status: "open",
    resolvedByAdminUserId: null,
    createdAt: now,
    resolvedAt: null,
  });

  return NextResponse.json({ requestId: result.insertedId.toString() }, { status: 201 });
}
