import { NextResponse } from "next/server";

export async function POST() {
  // Suspension/reactivation is deliberately single-account in Revision 3.
  // A future bulk workflow must add preview, exclusions, CAS and an audit
  // receipt rather than reusing this plural endpoint.
  return NextResponse.json({ code: "BULK_STATUS_NOT_SUPPORTED" }, { status: 410 });
}
