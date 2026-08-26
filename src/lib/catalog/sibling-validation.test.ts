import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@/lib/prisma";
import { validateCatalogGovernancePayload, type CatalogGovernancePayload } from "./governance";
import { loadCatalogSiblingValidationRows } from "./sibling-validation";

function payload(overrides: Partial<CatalogGovernancePayload> = {}): CatalogGovernancePayload {
  return {
    term: "run",
    lemma: "run",
    partOfSpeech: "verb",
    level: "A2",
    category: "actions",
    definitionZh: "經營",
    acceptedAnswersZh: ["經營"],
    phoneticIpa: "/rʌn/",
    exampleEn: "They run a shop.",
    exampleZh: "他們經營一間店。",
    acceptedFormsEn: ["run"],
    synonymsEn: [],
    antonymsEn: [],
    enableEnToZh: true,
    distractorZh: ["跑步", "管理", "購買", "關閉", "參觀", "建造"],
    enableZhToEn: true,
    distractorEn: ["manage", "buy", "close", "visit", "build", "sell"],
    sourceReference: null,
    contributorRef: null,
    changeNote: null,
    retirementReason: null,
    ...overrides,
  };
}

test("preview and submission sibling loader exposes latest sibling answers to the same validator", async () => {
  const sibling = payload({
    level: "A1",
    definitionZh: "跑步",
    acceptedAnswersZh: ["跑步"],
    exampleEn: "I run every day.",
    exampleZh: "我每日跑步。",
    distractorZh: ["步行", "跳躍", "游泳", "駕駛", "攀爬", "飛行"],
  });
  const revision = {
    revision: 2,
    term: sibling.term,
    lemma: sibling.lemma,
    pos: sibling.partOfSpeech,
    level: sibling.level,
    category: sibling.category,
    definitionZh: sibling.definitionZh,
    acceptedAnswersZh: sibling.acceptedAnswersZh,
    phoneticIpa: sibling.phoneticIpa,
    exampleEn: sibling.exampleEn,
    exampleZh: sibling.exampleZh,
    acceptedFormsEn: sibling.acceptedFormsEn,
    synonymsEn: sibling.synonymsEn,
    antonymsEn: sibling.antonymsEn,
    enableEnToZh: sibling.enableEnToZh,
    distractorZh: sibling.distractorZh,
    enableZhToEn: sibling.enableZhToEn,
    distractorEn: sibling.distractorEn,
    sourceReference: sibling.sourceReference,
    contributorRef: sibling.contributorRef,
    changeNote: sibling.changeNote,
    retirementReason: sibling.retirementReason,
  };
  const client = {
    wordSense: {
      findMany: async () => [{
        senseKey: "run-v-run-a1",
        catalogEntry: { catalogKey: "run" },
        approvedRevision: revision,
        revisions: [revision],
      }],
    },
  } as unknown as Pick<Prisma.TransactionClient, "wordSense">;
  const target = payload();
  const siblingRows = await loadCatalogSiblingValidationRows(client, target, "run-v-operate-a2");
  const validation = validateCatalogGovernancePayload(target, {
    catalogKey: "run",
    senseKey: "run-v-operate-a2",
    sourceFile: "preview",
    sourceRow: 2,
  }, 3, siblingRows);
  assert.match(validation.errors.join("\n"), /en-zh distractor collides with a sibling-sense answer/u);
  assert.ok(validation.issues.some((issue) => issue.code === "CATALOG_DISTRACTOR_SIBLING_COLLISION" && issue.field === "distractorZh" && issue.direction === "EN_TO_ZH"));
});
