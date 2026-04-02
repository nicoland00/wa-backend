import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";

const createSchema = z.object({
  name: z.string().min(1),
  ixorigueRanchId: z.string().min(1),
  ownerUserId: z.string().optional(),
  status: z.enum(["draft", "approved"]).optional(),
});

export async function GET(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const queryUserId = request.nextUrl.searchParams.get("userId");

  const filter = isAdmin(user) && queryUserId
    ? { ownerUserId: new ObjectId(queryUserId) }
    : isAdmin(user)
      ? {}
      : { ownerUserId: new ObjectId(user.userId) };

  const farms = await db.collection("farms").find(filter).sort({ createdAt: -1 }).toArray();

  return NextResponse.json({
    farms: farms.map((farm) => ({
      ...farm,
      _id: farm._id.toString(),
      ownerUserId: farm.ownerUserId.toString(),
      approvedByUserId: farm.approvedByUserId ? farm.approvedByUserId.toString() : null,
      rejectedByUserId: farm.rejectedByUserId ? farm.rejectedByUserId.toString() : null,
    })),
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

  const now = new Date();
  const ownerUserId = isAdmin(user) && parsed.data.ownerUserId ? new ObjectId(parsed.data.ownerUserId) : new ObjectId(user.userId);
  const status = isAdmin(user) ? parsed.data.status ?? "approved" : "draft";

  const doc = {
    ownerUserId,
    name: parsed.data.name,
    ixorigueRanchId: parsed.data.ixorigueRanchId,
    status,
    submittedAt: null,
    approvedAt: status === "approved" ? now : null,
    approvedByUserId: status === "approved" && isAdmin(user) ? new ObjectId(user.userId) : null,
    rejectedAt: null,
    rejectedByUserId: null,
    rejectionReason: null,
    lotsLockedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  const result = await db.collection("farms").insertOne(doc);

  return NextResponse.json({ farmId: result.insertedId.toString() }, { status: 201 });
}
