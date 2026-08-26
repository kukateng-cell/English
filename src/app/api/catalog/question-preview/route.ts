import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import {
  CATALOG_PRIVATE_HEADERS,
  catalogResponse,
  catalogRouteError,
  parseJsonObject,
  requireCatalogActor,
} from "@/lib/catalog/api";
import {
  parseCatalogGovernancePayload,
  payloadFingerprint,
  payloadFromRevision,
  validateCatalogGovernancePayload,
} from "@/lib/catalog/governance";
import { normalizeCatalogText } from "@/lib/catalog/csv";
import { catalogPayloadToQuestionWord } from "@/lib/catalog/question-preview";
import { buildObjectiveQuestion, type QuestionDirection } from "@/lib/learning-policy/question";
import { loadCatalogSiblingValidationRows } from "@/lib/catalog/sibling-validation";
import { CATALOG_STRUCTURED_ISSUE_VERSION } from "@/lib/catalog/validation-issue-contract";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await parseJsonObject(req, MAX_BODY_BYTES);
    const payload = parseCatalogGovernancePayload(body.payload);
    const direction = body.direction;
    const seed = typeof body.seed === "string" ? body.seed.trim() : "";
    const senseKey = typeof body.senseKey === "string" ? body.senseKey.trim() : "";
    if ((direction !== "en-zh" && direction !== "zh-en") || !seed || seed.length > 160) {
      throw new Error("CATALOG_QUESTION_PREVIEW_INVALID");
    }

    const siblingRows = await loadCatalogSiblingValidationRows(prisma, payload, senseKey || undefined);
    const validation = validateCatalogGovernancePayload(payload, {
      sourceFile: "teacher-question-preview.csv",
      sourceRow: 2,
      catalogKey: "teacher-question-preview",
      senseKey: senseKey || "teacher-question-preview-sense",
    }, 1, siblingRows);
    if (validation.errors.length) {
      return catalogResponse("CATALOG_QUESTION_PREVIEW_VALIDATION_FAILED", 422, {
        errors: validation.errors,
        warnings: validation.warnings,
        issues: validation.issues,
        structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
      });
    }

    const normalizedTerm = normalizeCatalogText(payload.term);
    const siblingSenses = await prisma.wordSense.findMany({
      where: {
        normalizedTerm,
        approvedRevisionId: { not: null },
        ...(senseKey ? { senseKey: { not: senseKey } } : {}),
      },
      select: {
        id: true,
        senseKey: true,
        approvedRevision: {
          select: {
            term: true,
            lemma: true,
            pos: true,
            level: true,
            category: true,
            definitionZh: true,
            acceptedAnswersZh: true,
            phoneticIpa: true,
            exampleEn: true,
            exampleZh: true,
            acceptedFormsEn: true,
            synonymsEn: true,
            antonymsEn: true,
            enableEnToZh: true,
            distractorZh: true,
            enableZhToEn: true,
            distractorEn: true,
            sourceReference: true,
            contributorRef: true,
            changeNote: true,
            retirementReason: true,
          },
        },
      },
    });

    const targetId = senseKey || `preview-${payloadFingerprint(payload).slice(0, 24)}`;
    const target = catalogPayloadToQuestionWord({ id: targetId, senseId: targetId, payload });
    const siblings = siblingSenses.flatMap((sense) => sense.approvedRevision
      ? [catalogPayloadToQuestionWord({
          id: sense.id,
          senseId: sense.senseKey,
          payload: payloadFromRevision(sense.approvedRevision),
        })]
      : []);
    const question = buildObjectiveQuestion(target, [target, ...siblings], seed, {
      direction: direction as QuestionDirection,
    });
    if (!question) {
      return catalogResponse("CATALOG_QUESTION_PREVIEW_UNAVAILABLE", 422, {
        direction,
        message: "未有足夠三個安全且不撞答案的干擾項，或該方向尚未啟用。",
      });
    }
    const correctOption = question.options.find((option) => option.id === question.correctOptionId);
    return NextResponse.json({
      preview: {
        prompt: question.prompt,
        direction: question.direction,
        options: question.options,
        correctOptionId: question.correctOptionId,
        correctAnswer: correctOption?.text ?? "",
        itemConstructionVersion: question.itemConstructionVersion,
      },
      warnings: validation.warnings,
      structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
    }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
