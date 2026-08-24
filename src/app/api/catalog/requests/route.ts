import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { catalogAccess } from "@/lib/catalog/access";
import { readCatalogWorkspaceVersion } from "@/lib/catalog/workspace-version";
import { catalogGovernancePayloadFromUnknown } from "@/lib/catalog/governance";

function headers() {
  return { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
}

function response(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, { status, headers: headers() });
}

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return response(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status);
  try {
    const access = await catalogAccess(auth);
    if (!access.canReview) return response("CATALOG_REVIEW_FORBIDDEN", 403);
    const searchParams = new URL(req.url).searchParams;
    const requestedStatus = searchParams.get("status") ?? "PENDING";
    const status = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(requestedStatus) ? requestedStatus : "PENDING";
    if (searchParams.get("view") === "signature") {
      if (status !== "PENDING") return response("CATALOG_INPUT_INVALID", 422);
      const version = await readCatalogWorkspaceVersion();
      return NextResponse.json({
        signature: version.signature,
        mutationRevision: version.mutationRevision,
        count: version.pendingCount,
        hasMore: version.pendingHasMore,
      }, { headers: headers() });
    }
    const initialVersion = await readCatalogWorkspaceVersion();
    const requests = await prisma.catalogChangeRequest.findMany({
      where: { status: status as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED", submissionProposalGroupId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1001,
      select: {
        id: true,
        kind: true,
        status: true,
        operationId: true,
        baseRevision: true,
        baseStatus: true,
        revision: true,
        payload: true,
        afterPayloadSnapshot: true,
        reason: true,
        reviewNote: true,
        createdAt: true,
        reviewedAt: true,
        proposerId: true,
        reviewerId: true,
        catalogKey: true,
        senseKey: true,
        sense: { select: { senseKey: true, term: true, level: true, category: true } },
        sourceImportRow: { select: { id: true, sourceFile: true, sourceRow: true, senseKey: true, catalogKey: true, primaryDisposition: true, eligibilityResult: true, issues: true } },
        proposer: { select: { teacherProfile: { select: { legalName: true } }, accountName: true } },
      },
    });
    const hasMore = requests.length > 1000;
    const version = await readCatalogWorkspaceVersion();
    if (version.signature !== initialVersion.signature) return response("CATALOG_READ_STALE", 409);
    return NextResponse.json({ hasMore, mutationRevision: version.mutationRevision, signature: version.signature, requests: (hasMore ? requests.slice(0, 1000) : requests).map((item) => ({
      ...item,
      payload: catalogGovernancePayloadFromUnknown(item.payload)
        ?? catalogGovernancePayloadFromUnknown(item.afterPayloadSnapshot)
        ?? item.payload,
      catalogKey: item.catalogKey,
      senseKey: item.senseKey,
      createdAt: item.createdAt.toISOString(),
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      proposer: { legalName: item.proposer.teacherProfile?.legalName ?? "", accountName: item.proposer.accountName },
    })) }, { headers: headers() });
  } catch (error) {
    console.error("[catalog] request list failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return response("CATALOG_REVIEW_READ_FAILED", 500);
  }
}
