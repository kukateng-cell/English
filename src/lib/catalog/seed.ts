import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Prisma } from "../../generated/prisma";
import {
  CATALOG_NORMALIZATION_VERSION,
  CATALOG_VALIDATOR_VERSION,
  type CatalogEligibilityResult,
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
  localBootstrap: boolean;
  actor: string;
  /** Rebuild keeps the revision BUILDING until demo data and checks finish. */
  finalize?: boolean;
}

export interface CatalogSeedResult {
  sourceDigest: string;
  rows: number;
  validRows: number;
  validationFailed: number;
  localEligible: number;
  draftBlocked: number;
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
  if (options.environment === "production" && options.localBootstrap) {
    throw new Error("LOCAL_DEMO_BOOTSTRAP is forbidden in production.");
  }
  const files = await readCatalogSourceFiles(options.rootDir);
  const sourceDigest = digest(files.map((file) => `${file.relativePath}\0${file.digest}`).join("\n"));
  const root = sourceRoot(options.rootDir);
  const manifest = await readIdentityManifest(root, sourceDigest);
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
    if (!isCatalogCategory(row.category)) validation.errors.push(`unknown category: ${row.category}`);
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
  const currentSenseKeys = new Set(
    rows.filter((_, index) => validations[index]?.errors.length === 0)
      .map((row) => row.senseKey),
  );
  const catalogRevisionKey = `catalog_${sourceDigest.slice(0, 24)}`;
  const catalogRevision = await tx.catalogRevision.upsert({
    where: { revisionKey: catalogRevisionKey },
    create: {
      revisionKey: catalogRevisionKey,
      sourceDigest,
      taxonomyDigest: digest(JSON.stringify(CATALOG_TAXONOMY_VERSION)),
      validatorVersion: CATALOG_VALIDATOR_VERSION,
      normalizationVersion: CATALOG_NORMALIZATION_VERSION,
      activationBasis: options.localBootstrap ? "LOCAL_DEMO_BOOTSTRAP" : "DRAFT_IMPORT",
      status: "BUILDING",
    },
    update: {
      sourceDigest,
      status: "BUILDING",
      activationBasis: options.localBootstrap ? "LOCAL_DEMO_BOOTSTRAP" : "DRAFT_IMPORT",
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
  const eligibilityRows: Array<Prisma.CatalogEligibilityCreateManyInput> = [];
  const projectionRows: Array<{ row: NormalizedCatalogRow; revisionId: string }> = [];
  let validRows = 0;
  let localEligible = 0;
  let draftBlocked = 0;
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
    const eligibility: CatalogEligibilityResult = validation.eligibility;
    if (validation.errors.length === 0) validRows += 1;
    if (eligibility === "LOCAL_ELIGIBLE" && options.localBootstrap && validation.errors.length === 0) localEligible += 1;
    else draftBlocked += 1;
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
    });
    if (validation.errors.length > 0 || assignment.resolution === "MERGE" || assignment.resolution === "CONFLICT") continue;

    const entry = await tx.catalogEntry.upsert({
      where: { catalogKey: row.catalogKey },
      create: { catalogKey: row.catalogKey, lemma: row.lemma, normalizedLemma: row.normalizedLemma },
      update: { lemma: row.lemma, normalizedLemma: row.normalizedLemma },
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
        term: row.term,
        normalizedTerm: row.normalizedTerm,
        pos: row.partOfSpeech || null,
        level: row.level,
        category: row.category,
        status: "DRAFT",
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
    if (options.localBootstrap && validation.eligibility === "LOCAL_ELIGIBLE") {
      eligibilityRows.push({
        senseId: sense.id,
        senseRevisionId: revision.id,
        catalogRevisionId: catalogRevision.id,
        environment: options.environment,
        basis: "LOCAL_DEMO_BOOTSTRAP",
        sourceDigest,
        validatorVersion: CATALOG_VALIDATOR_VERSION,
        reason: "Development/test fixture eligibility; not teacher approval.",
      });
      projectionRows.push({ row, revisionId: revision.id });
    }
  }

  await tx.catalogImportRow.deleteMany({ where: { batchId: batch.id } });
  if (importRows.length > 0) await tx.catalogImportRow.createMany({ data: importRows });
  await tx.catalogEligibility.deleteMany({ where: { catalogRevisionId: catalogRevision.id, environment: options.environment } });
  if (eligibilityRows.length > 0) await tx.catalogEligibility.createMany({ data: eligibilityRows, skipDuplicates: true });

  const primarySenseKeys = new Set(
    manifest.assignments.filter((assignment) => assignment.legacyPrimary).map((assignment) => assignment.senseKey),
  );
  const staleCurrentWords = {
    senseId: { not: null },
    sense: { senseKey: { notIn: [...currentSenseKeys] } },
  } satisfies Prisma.WordWhereInput;
  await tx.legacyWordSenseMap.deleteMany({ where: { word: staleCurrentWords } });
  await tx.word.updateMany({
    where: staleCurrentWords,
    data: { senseId: null, senseKey: null, contentRevisionId: null, catalogRevisionId: null },
  });
  await tx.wordSense.updateMany({
    where: {
      senseKey: { notIn: [...currentSenseKeys] },
      revisions: { some: { catalogRevisionId: catalogRevision.id } },
    },
    data: { status: "RETIRED" },
  });
  await tx.legacyWordSenseMap.deleteMany({ where: { word: { catalogRevisionId: { not: catalogRevision.id } } } });
  for (const item of projectionRows) {
    const sense = await tx.wordSense.findUniqueOrThrow({ where: { senseKey: item.row.senseKey } });
    const revision = await tx.wordSenseRevision.findUniqueOrThrow({ where: { id: item.revisionId } });
    const word = await tx.word.upsert({
      where: { senseId: sense.id },
      create: {
        senseId: sense.id,
        senseKey: sense.senseKey,
        contentRevisionId: revision.id,
        catalogRevisionId: catalogRevision.id,
        term: revision.term,
        phonetic: revision.phoneticIpa,
        pos: revision.pos,
        definition: revision.definitionZh,
        level: revision.level,
        category: revision.category,
        examples: revision.exampleEn && revision.exampleZh ? json([{ en: revision.exampleEn, zh: revision.exampleZh }]) : json([]),
        synonyms: revision.synonymsEn,
        antonyms: revision.antonymsEn,
        acceptedAnswers: revision.acceptedAnswersZh,
        acceptedForms: revision.acceptedFormsEn,
        distractorZh: revision.distractorZh,
        distractorEn: revision.distractorEn,
        enableEnToZh: revision.enableEnToZh,
        enableZhToEn: revision.enableZhToEn,
      },
      update: {
        senseKey: sense.senseKey,
        contentRevisionId: revision.id,
        catalogRevisionId: catalogRevision.id,
        term: revision.term,
        phonetic: revision.phoneticIpa,
        pos: revision.pos,
        definition: revision.definitionZh,
        level: revision.level,
        category: revision.category,
        examples: revision.exampleEn && revision.exampleZh ? json([{ en: revision.exampleEn, zh: revision.exampleZh }]) : json([]),
        synonyms: revision.synonymsEn,
        antonyms: revision.antonymsEn,
        acceptedAnswers: revision.acceptedAnswersZh,
        acceptedForms: revision.acceptedFormsEn,
        distractorZh: revision.distractorZh,
        distractorEn: revision.distractorEn,
        enableEnToZh: revision.enableEnToZh,
        enableZhToEn: revision.enableZhToEn,
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

  await tx.catalogRevision.updateMany({ where: { id: { not: catalogRevision.id }, status: "READY" }, data: { status: "RETIRED" } });
  if (options.finalize !== false) await tx.catalogRevision.update({ where: { id: catalogRevision.id }, data: { status: "READY" } });
  if (options.finalize !== false) await tx.catalogImportBatch.update({ where: { id: batch.id }, data: { status: "READY" } });
  await tx.catalogImportBatch.update({ where: { id: batch.id }, data: { status: options.finalize === false ? "BUILDING" : "READY", report: json({ ...report, sourceDigest, localBootstrap: options.localBootstrap }) } });
  return {
    sourceDigest,
    rows: rows.length,
    validRows,
    validationFailed: rows.length - validRows,
    localEligible,
    draftBlocked,
    projections,
    primaryMappings: projectionRows.filter((item) => primarySenseKeys.has(item.row.senseKey)).length,
    catalogRevisionKey,
  };
}
