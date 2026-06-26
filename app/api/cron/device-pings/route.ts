import { NextRequest, NextResponse } from "next/server";
import { captureAllRanchDevicePings } from "@/lib/server/device-pings";

export const maxDuration = 60;

// Scheduled capture of every ranch's latest device locations.
// If CRON_SECRET is set, accept it either as `Authorization: Bearer <secret>`
// or as a `?token=<secret>` query param (easier for cron services that can't
// send custom headers). If CRON_SECRET is unset, the endpoint is open.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const token = new URL(request.url).searchParams.get("token");
    const ok = auth === `Bearer ${secret}` || token === secret;
    if (!ok) {
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
