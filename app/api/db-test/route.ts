import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = await getDb();
    const res = await db.collection("messages").insertOne({
      test: true,
      createdAt: new Date(),
    });

    console.log("✅ DB TEST inserted:", res.insertedId.toString());
    return NextResponse.json({ ok: true, insertedId: res.insertedId.toString() });
  } catch (e) {
    console.error("❌ DB TEST failed:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}