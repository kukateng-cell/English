import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Prisma } from "../../generated/prisma";
import {
  CATALOG_NORMALIZATION_VERSION,
  CATALOG_VALIDATOR_VERSION,
  type CatalogActivationResult,
  type CatalogPrimaryDisposition,
  type CatalogSourceRow,
  buildCatalogImportReport,
  normalizeCatalogRow,
  parseCatalogCsv,
  validateCatalogRow,
  type NormalizedCatalogRow,
} from "./csv";
import { CATALOG_TAXONOMY_VERSION, isCatalogCategory } from "./taxonomy";
import {
  CATALOG_IDENTITY_MANIFEST_PATH,
  CATALOG_IDENTITY_MANIFEST_VERSION,
  identityFingerprint,
  identityMatchKey,
  type CatalogIdentityManifest,
} from "./identity";
import {
  catalogSenseKeySetDigest,
  readCatalogInitialActivationManifest,
} from "./initial-activation";

export const CATALOG_SOURCE_FILES = [
  "outputs/a1-word-catalog-reference-v1/a1-word-catalog-reference-v1.csv",
  "outputs/a2-word-catalog-reference-v1/a2-word-catalog-reference-v1.csv",
  "outputs/b1-word-catalog-reference-v1/b1-word-catalog-reference-v1.csv",
  "outputs/b2-word-catalog-reference-v1/b2-word-catalog-reference-v1.csv",
] as const;

export interface CatalogSourceFile {
  relativePath: string;
  text: string;
  digest: string;
  rows: CatalogSourceRow[];
}

export interface CatalogSeedOptions {
  rootDir?: string;
  environment: "development" | "test" | "production";
  actor: string;
  /** Rebuild keeps the revision BUILDING until demo data and checks finish. */
  finalize?: boolean;
}

export interface CatalogSeedResult {
  sourceDigest: string;
  rows: number;
  validRows: number;
  validationFailed: number;
  activationEligible: number;
  active: number;
  draft: number;
  retired: number;
  activated: number;
  projections: number;
  primaryMappings: number;
  catalogRevisionKey: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sourceRoot(rootDir?: string): string {
  return rootDir ?? fileURLToPath(new URL("../../../", import.meta.url));
}

async function readIdentityManifest(rootDir: string, sourceDigest: string): Promise<CatalogIdentityManifest> {
  const manifestPath = path.join(rootDir, CATALOG_IDENTITY_MANIFEST_PATH);
  let parsed: CatalogIdentityManifest;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8")) as CatalogIdentityManifest;
  } catch (error) {
    throw new Error(`Cannot read checked-in catalog identity manifest ${manifestPath}: ${String(error)}`);
  }
  if (
    parsed.manifestVersion !== CATALOG_IDENTITY_MANIFEST_VERSION ||
    parsed.schemaVersion !== "word-catalog-v1" ||
    parsed.sourceDigest !== sourceDigest ||
    !Array.isArray(parsed.assignments)
  ) {
    throw new Error("Catalog identity manifest version or source digest does not match the CSV inputs; regenerate it explicitly.");
  }
  return parsed;
}

export async function readCatalogSourceFiles(rootDir?: string): Promise<CatalogSourceFile[]> {
  const root = sourceRoot(rootDir);
  return Promise.all(CATALOG_SOURCE_FILES.map(async (relativePath) => {
    const text = await readFile(path.join(root, relativePath), "utf8");
    return {
      relativePath,
      text,
      digest: digest(text),
      rows: parseCatalogCsv(text, relativePath),
    } satisfies CatalogSourceFile;
  }));
}

export async function seedCatalog(
  tx: Prisma.TransactionClient,
  options: CatalogSeedOptions,
): Promise<CatalogSeedResult> {
  const files = await readCatalogSourceFiles(options.rootDir);
  const sourceDigest = digest(files.map((file) => `${file.relativePath}\0${file.digest}`).join("\n"));
  const root = sourceRoot(options.rootDir);
  const manifest = await readIdentityManifest(root, sourceDigest);
  const activationManifest = await readCatalogInitialActivationManifest(
    root,
    sourceDigest,
  );
  const allSourceRows = files.flatMap((file) => file.rows);
  const assignments = new Map(manifest.assignments.map((assignment) => [`${assignment.sourceFile}:${assignment.sourceRow}`, assignment]));
  if (assignments.size !== allSourceRows.length) {
    throw new Error(`Catalog identity manifest covers ${assignments.size} rows, but CSV inputs contain ${allSourceRows.length}.`);
  }
  const rows = allSourceRows.map((sourceRow) => {
    const assignment = assignments.get(`${sourceRow.sourceFile}:${sourceRow.sourceRow}`);
    if (!assignment || assignment.matchKey !== identityMatchKey(sourceRow) || assignment.identityFingerprint !== identityFingerprint(sourceRow)) {
      throw new Error(`Catalog identity assignment mismatch at ${sourceRow.sourceFile}:${sourceRow.sourceRow}; regenerate the manifest after an intentional CSV identity change.`);
    }
    if (!["CREATE", "KEEP_DISTINCT", "MERGE", "CONFLICT"].includes(assignment.resolution)) {
      throw new Error(`Unsupported catalog identity resolution at ${sourceRow.sourceFile}:${sourceRow.sourceRow}.`);
    }
    return normalizeCatalogRow({ ...sourceRow, catalog_key: assignment.catalogKey, sense_key: assignment.senseKey }, 0);
  });
  const byTerm = new Map<string, NormalizedCatalogRow[]>();
  for (const row of rows) byTerm.set(row.normalizedTerm, [...(byTerm.get(row.normalizedTerm) ?? []), row]);
  const validations = rows.map((row) => {
    const siblings = (byTerm.get(row.normalizedTerm) ?? []).filter((sibling) => sibling.senseKey !== row.senseKey);
    const validation = validateCatalogRow(row, siblings);
    if (!isCatalogCategory(row.category)) {
      validation.errors.push(`unknown category: ${row.category}`);
      validation.directionEligible = false;
      validation.eligibility = "DRAFT_BLOCKED";
    }
    return validation;
  });
  const manifestDispositions: CatalogPrimaryDisposition[] = rows.map((row) => {
    const assignment = assignments.get(`${row.sourceFile}:${row.sourceRow}`)!;
    return assignment.resolution === "MERGE"
      ? "MERGED"
      : assignment.resolution === "CONFLICT"
        ? "CONFLICT"
        : "CREATED_DRAFT";
  });
  const report = buildCatalogImportReport(rows, validations, "A1-A2-B1-B2", manifestDispositions);
  const measured = {
    sourceRows: rows.length,
    validRows: validations.filter((validation) => validation.errors.length === 0).length,
    activeSenses: validations.filter(
      (validation) =>
        validation.errors.length === 0 &&
        validation.eligibility === "ACTIVATION_ELIGIBLE",
    ).length,
    draftSenses: validations.filter(
      (validation) =>
        validation.errors.length === 0 &&
        validation.eligibility === "DRAFT_BLOCKED",
    ).length,
    validationFailedRows: validations.filter(
      (validation) => validation.errors.length > 0,
    ).length,
  };
  const measuredSelectionDigests = {
    activeSenseKeysSha256: catalogSenseKeySetDigest(
      rows.flatMap((row, index) => {
        const validation = validations[index]!;
        return validation.errors.length === 0 &&
          validation.eligibility === "ACTIVATION_ELIGIBLE"
          ? [row.senseKey]
          : [];
      }),
    ),
    draftSenseKeysSha256: catalogSenseKeySetDigest(
      rows.flatMap((row, index) => {
        const validation = validations[index]!;
        return validation.errors.length === 0 &&
          validation.eligibility === "DRAFT_BLOCKED"
          ? [row.senseKey]
          : [];
      }),
    ),
  };
  if (
    Object.entries(activationManifest.expected).some(
      ([key, expected]) =>
        measured[key as keyof typeof measured] !== expected,
    ) ||
    measuredSelectionDigests.activeSenseKeysSha256 !==
      activationManifest.selectionDigests.activeSenseKeysSha256 ||
    measuredSelectionDigests.draftSenseKeysSha256 !==
      activationManifest.selectionDigests.draftSenseKeysSha256
  ) {
    throw new Error(
      `Catalog initial activation decision does not match the approved manifest: ${JSON.stringify({ expected: activationManifest.expected, measured, expectedSelectionDigests: activationManifest.selectionDigests, measuredSelectionDigests })}`,
    );
  }
  const catalogRevisionKey = `catalog_${sourceDigest.slice(0, 24)}`;
  const catalogRevision = await tx.catalogRevision.upsert({
    where: { revisionKey: catalogRevisionKey },
    create: {
      revisionKey: catalogRevisionKey,
      sourceDigest,
      taxonomyDigest: digest(JSON.stringify(CATALOG_TAXONOMY_VERSION)),
      validatorVersion: CATALOG_VALIDATOR_VERSION,
      normalizationVersion: CATALOG_NORMALIZATION_VERSION,
      activationBasis: "INITIAL_BASELINE_MANIFEST",
      status: "BUILDING",
    },
    update: {
      sourceDigest,
      activationBasis: "INITIAL_BASELINE_MANIFEST",
      status: "BUILDING",
    },
  });
  const batch = await tx.catalogImportBatch.upsert({
    where: { sourceDigest },
    create: {
      sourceDigest,
      taxonomyDigest: digest(JSON.stringify(CATALOG_TAXONOMY_VERSION)),
      validatorVersion: CATALOG_VALIDATOR_VERSION,
      normalizationVersion: CATALOG_NORMALIZATION_VERSION,
      status: "BUILDING",
      catalogRevisionId: catalogRevision.id,
      manifest: json({ files: files.map((file) => ({ path: file.relativePath, digest: file.digest })), actor: options.actor, environment: options.environment }),
      report: json(report),
    },
    update: {
      status: "BUILDING",
      catalogRevisionId: catalogRevision.id,
      manifest: json({ files: files.map((file) => ({ path: file.relativePath, digest: file.digest })), actor: options.actor, environment: options.environment }),
      report: json(report),
    },
  });

  const importRows: Array<Prisma.CatalogImportRowCreateManyInput> = [];
  const projectionRows: Array<{ row: NormalizedCatalogRow; revisionId: string }> = [];
  let validRows = 0;
  let activationEligible = 0;
  let activated = 0;
  let projections = 0;

  for (const [index, row] of rows.entries()) {
    const validation = validations[index]!;
    const assignment = assignments.get(`${row.sourceFile}:${row.sourceRow}`)!;
    const primaryDisposition: CatalogPrimaryDisposition = validation.errors.length > 0
      ? "VALIDATION_FAILED"
      : assignment.resolution === "MERGE"
        ? "MERGED"
        : assignment.resolution === "CONFLICT"
          ? "CONFLICT"
          : "CREATED_DRAFT";
    const eligibility: CatalogActivationResult = validation.eligibility;
    if (validation.errors.length === 0) validRows += 1;
    if (validation.errors.length === 0) {
      if (eligibility === "ACTIVATION_ELIGIBLE") activationEligible += 1;
    }
    importRows.push({
      batchId: batch.id,
      sourceFile: row.sourceFile,
      sourceRow: row.sourceRow,
      rowDigest: row.rowDigest,
      primaryDisposition,
      eligibilityResult: eligibility,
      catalogKey: row.catalogKey,
      senseKey: row.senseKey,
      issues: json({ errors: validation.errors, warnings: validation.warnings }),
      sourceData: json(row),
    });
    if (validation.errors.length > 0 || assignment.resolution === "MERGE" || assignment.resolution === "CONFLICT") continue;

    const entry = await tx.catalogEntry.upsert({
      where: { catalogKey: row.catalogKey },
      create: { catalogKey: row.catalogKey, lemma: row.lemma, normalizedLemma: row.normalizedLemma },
      // catalogKey identifies a stable headword. Re-importing source CSV must
      // not silently rewrite that identity after teachers have reviewed it.
      update: {},
    });
    const existingSense = await tx.wordSense.findUnique({
      where: { senseKey: row.senseKey },
      select: { id: true, approvedRevisionId: true },
    });
    const sense = await tx.wordSense.upsert({
      where: { senseKey: row.senseKey },
      create: {
        catalogEntryId: entry.id,
        senseKey: row.senseKey,
        term: row.term,
        normalizedTerm: row.normalizedTerm,
        pos: row.partOfSpeech || null,
        level: row.level,
        category: row.category,
        status: "DRAFT",
      },
      update: {
        catalogEntryId: entry.id,
        ...(existingSense?.approvedRevisionId ? {} : {
          term: row.term,
          normalizedTerm: row.normalizedTerm,
          pos: row.partOfSpeech || null,
          level: row.level,
          category: row.category,
        }),
      },
    });
    const revisionNumber = row.recordRevision ?? 1;
    const contentDigest = digest(JSON.stringify({ ...row, parseErrors: undefined, catalogKey: undefined, senseKey: undefined }));
    const existingRevision = await tx.wordSenseRevision.findUnique({
      where: { senseId_revision: { senseId: sense.id, revision: revisionNumber } },
      select: { id: true, contentDigest: true },
    });
    if (existingRevision && existingRevision.contentDigest !== contentDigest) {
      throw new Error(`${row.sourceFile}:${row.sourceRow} changes immutable sense revision ${row.senseKey}; increment record_revision before re-importing.`);
    }
    const revision = existingRevision
      ? await tx.wordSenseRevision.update({
        where: { id: existingRevision.id },
        data: { catalogRevisionId: catalogRevision.id },
      })
      : await tx.wordSenseRevision.create({
        data: {
        senseId: sense.id,
        revision: revisionNumber,
        term: row.term,
        lemma: row.lemma,
        pos: row.partOfSpeech || null,
        level: row.level,
        category: row.category,
        definitionZh: row.definitionZh,
        acceptedAnswersZh: row.acceptedAnswersZh,
        phoneticIpa: row.phoneticIpa,
        exampleEn: row.exampleEn,
        exampleZh: row.exampleZh,
        acceptedFormsEn: row.acceptedFormsEn,
        synonymsEn: row.synonymsEn,
        antonymsEn: row.antonymsEn,
        enableEnToZh: row.enableEnToZh,
        distractorZh: row.distractorZh,
        enableZhToEn: row.enableZhToEn,
        distractorEn: row.distractorEn,
        contentDigest,
        sourceReference: row.sourceReference,
        contributorRef: row.contributorRef,
        changeNote: row.changeNote,
        retirementReason: row.retirementReason,
        catalogRevisionId: catalogRevision.id,
      },
      });
    let currentSense = await tx.wordSense.findUniqueOrThrow({
      where: { id: sense.id },
      select: { id: true, status: true, approvedRevisionId: true },
    });
    if (
      validation.eligibility === "ACTIVATION_ELIGIBLE" &&
      currentSense.status === "DRAFT" &&
      !currentSense.approvedRevisionId
    ) {
      currentSense = await tx.wordSense.update({
        where: { id: sense.id },
        data: { status: "ACTIVE", approvedRevisionId: revision.id },
        select: { id: true, status: true, approvedRevisionId: true },
      });
      activated += 1;
    }
    if (currentSense.status === "ACTIVE" && currentSense.approvedRevisionId) {
      projectionRows.push({
        row,
        revisionId: currentSense.approvedRevisionId,
      });
    }
  }

  for (const importRow of importRows) {
    await tx.catalogImportRow.upsert({
      where: { batchId_sourceFile_sourceRow: { batchId: importRow.batchId, sourceFile: importRow.sourceFile, sourceRow: importRow.sourceRow } },
      create: importRow,
      update: {
        rowDigest: importRow.rowDigest,
        primaryDisposition: importRow.primaryDisposition,
        eligibilityResult: importRow.eligibilityResult,
        catalogKey: importRow.catalogKey,
        senseKey: importRow.senseKey,
        issues: importRow.issues,
        sourceData: importRow.sourceData,
      },
    });
  }
  const removedLegacyEligibility = await tx.catalogEligibility.deleteMany({
    where: { basis: "LOCAL_DEMO_BOOTSTRAP" },
  });

  const primarySenseKeys = new Set(
    manifest.assignments.filter((assignment) => assignment.legacyPrimary).map((assignment) => assignment.senseKey),
  );
  for (const item of projectionRows) {
    const sense = await tx.wordSense.findUniqueOrThrow({ where: { senseKey: item.row.senseKey } });
    const projectionRevision = await tx.wordSenseRevision.findUniqueOrThrow({
      where: { id: item.revisionId },
    });
    const word = await tx.word.upsert({
      where: { senseId: sense.id },
      create: {
        senseId: sense.id,
        senseKey: sense.senseKey,
        contentRevisionId: projectionRevision.id,
        catalogRevisionId: catalogRevision.id,
        term: projectionRevision.term,
        phonetic: projectionRevision.phoneticIpa,
        pos: projectionRevision.pos,
        definition: projectionRevision.definitionZh,
        level: projectionRevision.level,
        category: projectionRevision.category,
        examples: projectionRevision.exampleEn && projectionRevision.exampleZh ? json([{ en: projectionRevision.exampleEn, zh: projectionRevision.exampleZh }]) : json([]),
        synonyms: projectionRevision.synonymsEn,
        antonyms: projectionRevision.antonymsEn,
        acceptedAnswers: projectionRevision.acceptedAnswersZh,
        acceptedForms: projectionRevision.acceptedFormsEn,
        distractorZh: projectionRevision.distractorZh,
        distractorEn: projectionRevision.distractorEn,
        enableEnToZh: projectionRevision.enableEnToZh,
        enableZhToEn: projectionRevision.enableZhToEn,
      },
      update: {
        senseKey: sense.senseKey,
        contentRevisionId: projectionRevision.id,
        catalogRevisionId: catalogRevision.id,
        term: projectionRevision.term,
        phonetic: projectionRevision.phoneticIpa,
        pos: projectionRevision.pos,
        definition: projectionRevision.definitionZh,
        level: projectionRevision.level,
        category: projectionRevision.category,
        examples: projectionRevision.exampleEn && projectionRevision.exampleZh ? json([{ en: projectionRevision.exampleEn, zh: projectionRevision.exampleZh }]) : json([]),
        synonyms: projectionRevision.synonymsEn,
        antonyms: projectionRevision.antonymsEn,
        acceptedAnswers: projectionRevision.acceptedAnswersZh,
        acceptedForms: projectionRevision.acceptedFormsEn,
        distractorZh: projectionRevision.distractorZh,
        distractorEn: projectionRevision.distractorEn,
        enableEnToZh: projectionRevision.enableEnToZh,
        enableZhToEn: projectionRevision.enableZhToEn,
      },
    });
    projections += 1;
    if (primarySenseKeys.has(item.row.senseKey)) {
      await tx.legacyWordSenseMap.upsert({
        where: { wordId: word.id },
        create: { wordId: word.id, senseId: sense.id, isPrimary: true },
        update: { senseId: sense.id, isPrimary: true },
      });
    }
  }

  if (activated > 0) {
    await tx.catalogAuditEvent.create({
      data: {
        action: "INITIAL_BASELINE_ACTIVATED",
        toStatus: "ACTIVE",
        metadata: json({
          sourceDigest,
          manifestVersion: activationManifest.manifestVersion,
          selectionRule: activationManifest.selectionRule,
          selectionDigests: activationManifest.selectionDigests,
          activated,
        }),
      },
    });
  }

  const seededSenseKeys = rows.flatMap((row, index) => {
    const validation = validations[index]!;
    const assignment = assignments.get(`${row.sourceFile}:${row.sourceRow}`)!;
    return validation.errors.length === 0 &&
      assignment.resolution !== "MERGE" &&
      assignment.resolution !== "CONFLICT"
      ? [row.senseKey]
      : [];
  });
  const currentStatuses = await tx.wordSense.groupBy({
    by: ["status"],
    where: { senseKey: { in: seededSenseKeys } },
    _count: { _all: true },
  });
  const currentStatusCount = (status: "ACTIVE" | "DRAFT" | "RETIRED") =>
    currentStatuses.find((item) => item.status === status)?._count._all ?? 0;

  if (options.finalize !== false) await tx.catalogRevision.update({ where: { id: catalogRevision.id }, data: { status: "READY" } });
  await tx.catalogImportBatch.update({
    where: { id: batch.id },
    data: {
      status: options.finalize === false ? "BUILDING" : "READY",
      report: json({
        ...report,
        sourceDigest,
        initialActivation: {
          manifestVersion: activationManifest.manifestVersion,
          selectionRule: activationManifest.selectionRule,
          selectionDigests: activationManifest.selectionDigests,
          expected: activationManifest.expected,
        },
        removedLegacyEligibilityRows: removedLegacyEligibility.count,
      }),
    },
  });
  return {
    sourceDigest,
    rows: rows.length,
    validRows,
    validationFailed: rows.length - validRows,
    activationEligible,
    active: currentStatusCount("ACTIVE"),
    draft: currentStatusCount("DRAFT"),
    retired: currentStatusCount("RETIRED"),
    activated,
    projections,
    primaryMappings: projectionRows.filter((item) => primarySenseKeys.has(item.row.senseKey)).length,
    catalogRevisionKey,
  };
}
