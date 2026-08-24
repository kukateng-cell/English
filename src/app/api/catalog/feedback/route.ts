import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { Prisma, prisma } from "@/lib/prisma";
import {
  CATALOG_PRIVATE_HEADERS,
  catalogResponse,
  catalogRouteError,
  parseJsonObject,
  requireCatalogActor,
} from "@/lib/catalog/api";
import { parseCatalogFeedbackInput } from "@/lib/catalog/feedback";
import { payloadFingerprint } from "@/lib/catalog/governance";

const MAX_BODY_BYTES = 16 * 1024;
const PAGE_SIZE = 50;

function dto(item: {
  id: string;
  kind: string;
  status: string;
  senseKey: string | null;
  termSnapshot: string | null;
  baseRevision: number | null;
  message: string;
  suggestedValue: string | null;
  resolutionNote: string | null;
  revision: number;
  reporterId: string;
  resolverId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  reporter: { accountName: string; teacherProfile: { legalName: string } | null };
  resolver: { accountName: string; teacherProfile: { legalName: string } | null } | null;
}) {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    senseKey: item.senseKey,
    term: item.termSnapshot,
    baseRevision: item.baseRevision,
    message: item.message,
    suggestedValue: item.suggestedValue,
    resolutionNote: item.resolutionNote,
    revision: item.revision,
    reporterId: item.reporterId,
    resolverId: item.resolverId,
    reporter: {
      legalName: item.reporter.teacherProfile?.legalName ?? "",
      accountName: item.reporter.accountName,
    },
    resolver: item.resolver ? {
      legalName: item.resolver.teacherProfile?.legalName ?? "",
      accountName: item.resolver.accountName,
    } : null,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

const feedbackSelect = {
  id: true,
  kind: true,
  status: true,
  senseKey: true,
  termSnapshot: true,
  baseRevision: true,
  message: true,
  suggestedValue: true,
  resolutionNote: true,
  revision: true,
  reporterId: true,
  resolverId: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  reporter: { select: { accountName: true, teacherProfile: { select: { legalName: true } } } },
  resolver: { select: { accountName: true, teacherProfile: { select: { legalName: true } } } },
} satisfies Prisma.CatalogFeedbackSelect;

export async function GET(req: Request) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  try {
    const params = new URL(req.url).searchParams;
    const scope = params.get("scope") === "review" ? "review" : "mine";
    if (scope === "review" && !auth.canReview) return catalogResponse("CATALOG_FEEDBACK_FORBIDDEN", 403);
    const feedback = await prisma.catalogFeedback.findMany({
      where: scope === "review"
        ? { status: "OPEN", reporterId: { not: auth.actor.userId } }
        : { reporterId: auth.actor.userId },
      orderBy: [{ createdAt: scope === "review" ? "asc" : "desc" }, { id: "asc" }],
      take: PAGE_SIZE + 1,
      select: feedbackSelect,
    });
    return NextResponse.json({
      feedback: feedback.slice(0, PAGE_SIZE).map(dto),
      hasMore: feedback.length > PAGE_SIZE,
      canReview: auth.canReview,
    }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  try {
    const input = parseCatalogFeedbackInput(await parseJsonObject(req, MAX_BODY_BYTES));
    const fingerprint = payloadFingerprint(input);
    const existing = await prisma.catalogFeedback.findUnique({
      where: { reporterId_operationId: { reporterId: auth.actor.userId, operationId: input.operationId } },
      select: { requestFingerprint: true, ...feedbackSelect },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
      return NextResponse.json({ replay: true, feedback: dto(existing) }, { headers: CATALOG_PRIVATE_HEADERS });
    }

    const sense = input.senseKey ? await prisma.wordSense.findUnique({
      where: { senseKey: input.senseKey },
      select: { id: true, senseKey: true, term: true, approvedRevision: { select: { revision: true } } },
    }) : null;
    if (input.senseKey && !sense) throw new Error("CATALOG_SENSE_NOT_FOUND");

    try {
      const created = await prisma.catalogFeedback.create({
        data: {
          operationId: input.operationId,
          requestFingerprint: fingerprint,
          reporterId: auth.actor.userId,
          senseId: sense?.id ?? null,
          senseKey: sense?.senseKey ?? null,
          termSnapshot: sense?.term ?? input.term,
          baseRevision: sense?.approvedRevision?.revision ?? null,
          kind: input.kind,
          message: input.message,
          suggestedValue: input.suggestedValue,
        },
        select: feedbackSelect,
      });
      return NextResponse.json({ replay: false, feedback: dto(created) }, { status: 201, headers: CATALOG_PRIVATE_HEADERS });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const replay = await prisma.catalogFeedback.findUnique({
        where: { reporterId_operationId: { reporterId: auth.actor.userId, operationId: input.operationId } },
        select: { requestFingerprint: true, ...feedbackSelect },
      });
      if (!replay || replay.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
      return NextResponse.json({ replay: true, feedback: dto(replay) }, { headers: CATALOG_PRIVATE_HEADERS });
    }
  } catch (error) {
    return catalogRouteError(error);
  }
}
