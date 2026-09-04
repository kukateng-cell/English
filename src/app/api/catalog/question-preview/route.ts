import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
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
  validateCatalogGovernancePayload,
} from "@/lib/catalog/governance";
import { catalogPayloadToQuestionWord } from "@/lib/catalog/question-preview";
import { buildObjectiveQuestion, type QuestionDirection } from "@/lib/learning-policy/question";
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

    const validation = validateCatalogGovernancePayload(payload, {
      sourceFile: "teacher-question-preview.csv",
      sourceRow: 2,
      catalogKey: "teacher-question-preview",
      senseKey: senseKey || "teacher-question-preview-sense",
    }, 1);
    if (validation.errors.length) {
      return catalogResponse("CATALOG_QUESTION_PREVIEW_VALIDATION_FAILED", 422, {
        errors: validation.errors,
        warnings: validation.warnings,
        issues: validation.issues,
        structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
      });
    }

    const targetId = senseKey || `preview-${payloadFingerprint(payload).slice(0, 24)}`;
    const target = catalogPayloadToQuestionWord({ id: targetId, senseId: targetId, payload });
    const question = buildObjectiveQuestion(target, [target], seed, {
      direction: direction as QuestionDirection,
    });
    if (!question) {
      return catalogResponse("CATALOG_QUESTION_PREVIEW_UNAVAILABLE", 422, {
        direction,
        message: "未有足夠三個安全且不與答案重疊的干擾項，或該方向尚未啟用。",
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
