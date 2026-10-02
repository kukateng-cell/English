import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, parseJsonObject, requireCatalogActor } from "@/lib/catalog/api";
import { finalizeCatalogSubmissionBatch } from "@/lib/catalog/submission-server";
import { hashSessionJti, readRecentAuthGrantSnapshot } from "@/lib/recent-auth";

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { review: true, rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  const recent = await readRecentAuthGrantSnapshot({ req, userId: auth.actor.userId });
  if (!recent) return catalogResponse("RECENT_AUTH_REQUIRED", 401);
  try {
    const body = await parseJsonObject(req, 8 * 1024);
    const { batchId } = await params;
    const result = await finalizeCatalogSubmissionBatch({
      batchId,
      actorId: auth.actor.userId,
      expectedRevision: Number(body.expectedRevision),
      operationId: req.headers.get("idempotency-key") ?? "",
      recentAuth: {
        grantId: hashSessionJti(recent.sessionJti),
        tokenVersion: recent.user.tokenVersion,
        credentialRevision: recent.user.credentialRevision,
        reauthenticatedAt: recent.grant.reauthenticatedAt,
        expiresAt: recent.grant.expiresAt,
      },
    });
    return NextResponse.json(result, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
