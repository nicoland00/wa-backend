import { NextRequest, NextResponse } from "next/server";
import { captureAllRanchDevicePings } from "@/lib/server/device-pings";

export const maxDuration = 60;

// Scheduled (Vercel cron) capture of every ranch's latest device locations.
// Protected by CRON_SECRET: Vercel cron sends `Authorization: Bearer <secret>`.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = await captureAllRanchDevicePings();
    const inserted = results.reduce((sum, r) => sum + r.inserted, 0);
    return NextResponse.json({ ok: true, inserted, ranches: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
