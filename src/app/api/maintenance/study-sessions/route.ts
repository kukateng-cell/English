import { NextResponse } from "next/server";
import { cleanupExpiredStudySessions } from "@/lib/study-session-server";

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    req.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let deleted = 0;
  for (let batch = 0; batch < 10; batch++) {
    const count = await cleanupExpiredStudySessions();
    deleted += count;
    if (count < 1_000) break;
  }
  return NextResponse.json({ ok: true, deleted });
}
