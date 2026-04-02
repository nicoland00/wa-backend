import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { objectIdSchema } from "@/lib/validators/common";

const createSchema = z.object({
  farmId: objectIdSchema,
  name: z.string().min(1),
  ixorigueLotId: z.string().min(1),
  geometry: z.any().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const farmId = request.nextUrl.searchParams.get("farmId");
  if (!farmId || !ObjectId.isValid(farmId)) {
    return NextResponse.json({ error: "farmId required" }, { status: 400 });
  }

  const db = await getDb();
  const farm = await db.collection("farms").findOne({ _id: new ObjectId(farmId) });
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  const owns = farm.ownerUserId.toString() === user.userId;
  if (!isAdmin(user) && !owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const lots = await db.collection("lots").find({ farmId: new ObjectId(farmId) }).sort({ createdAt: -1 }).toArray();

  return NextResponse.json({
    lots: lots.map((lot) => ({ ...lot, _id: lot._id.toString(), farmId: lot.farmId.toString() })),
  });
}

export async function POST(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const farm = await db.collection("farms").findOne({ _id: new ObjectId(parsed.data.farmId) });
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  if (!isAdmin(user)) {
    const owns = farm.ownerUserId.toString() === user.userId;
    const canWrite = owns && farm.status === "draft" && farm.lotsLockedAt === null;

    if (!canWrite) {
      return NextResponse.json({ error: "Lots can be added only while farm is draft and unlocked" }, { status: 403 });
    }
  }

  const now = new Date();
  const result = await db.collection("lots").insertOne({
    farmId: new ObjectId(parsed.data.farmId),
    name: parsed.data.name,
    ixorigueLotId: parsed.data.ixorigueLotId,
    geometry: parsed.data.geometry ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ lotId: result.insertedId.toString() }, { status: 201 });
}
