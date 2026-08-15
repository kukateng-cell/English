import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const forbiddenKeys = /\b(?:temporaryPassword|passwordHash|rawPassword|accountName|legalName|contactEmail|nickname|studentId|rawIp|ipAddress)\b/u;
const credentialKeys = /\b(?:temporaryPassword|passwordHash|rawPassword|newPassword|currentPassword)\b/u;
const textExtensions = new Set([".log", ".yml", ".yaml", ".json", ".txt", ".csv", ".md", ".html"]);

async function listTextFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    // These are historical visual-QA captures, not roster runtime artifacts;
    // they intentionally contain source-code locator snapshots and are kept
    // as reference evidence.  Current roster traces/logs are scanned below.
    if (entry.name === ".playwright-cli") continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listTextFiles(filePath));
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(filePath);
  }
  return files;
}

async function main() {
  const { prisma } = await import("../src/lib/prisma.ts");
  try {
    const [dbRows] = await prisma.$queryRaw`
      SELECT
        (SELECT count(*)::int FROM "RosterImportBatch"
          WHERE "status"::text IN ('COMMITTED','CANCELLED','EXPIRED')
            AND (jsonb_typeof("stagedRows") <> 'null' OR jsonb_typeof("errorReport") <> 'null')) AS terminal_roster_staging,
        (SELECT count(*)::int FROM "AdminMutationBatch"
          WHERE "status"::text IN ('COMMITTED','CANCELLED','EXPIRED')
            AND (jsonb_typeof("payload") <> 'null' OR jsonb_typeof("errorReport") <> 'null')) AS terminal_mutation_payload,
        (SELECT count(*)::int FROM "AdminMutationBatch"
          WHERE COALESCE("payload"::text, '') ~* ${forbiddenKeys.source}) AS mutation_payload_pii,
        (SELECT count(*)::int FROM "SecurityEvent"
          WHERE COALESCE("metadata"::text, '') ~* ${credentialKeys.source}) AS security_credential_fields,
        (SELECT count(*)::int FROM "AdminOperationReceipt"
          WHERE COALESCE("summary"::text, '') ~* ${credentialKeys.source}) AS receipt_credential_fields,
        (SELECT count(*)::int FROM "User" WHERE "passwordHash" NOT LIKE '$2%') AS non_bcrypt_hash_rows
    `;

    const artifactRoots = [path.resolve("output/playwright"), path.resolve("test-results")];
    const artifactFiles = (await Promise.all(artifactRoots.map((root) => listTextFiles(root)))).flat();
    const artifactFindings = [];
    for (const filePath of artifactFiles) {
      const content = await readFile(filePath, "utf8").catch(() => "");
      if (forbiddenKeys.test(content)) artifactFindings.push(path.relative(process.cwd(), filePath));
    }

    const summary = {
      terminalRosterStaging: Number(dbRows.terminal_roster_staging),
      terminalMutationPayload: Number(dbRows.terminal_mutation_payload),
      mutationPayloadPii: Number(dbRows.mutation_payload_pii),
      securityCredentialFields: Number(dbRows.security_credential_fields),
      receiptCredentialFields: Number(dbRows.receipt_credential_fields),
      nonBcryptHashRows: Number(dbRows.non_bcrypt_hash_rows),
      textArtifactFiles: artifactFiles.length,
      artifactFindings: artifactFindings.length,
    };
    console.log(JSON.stringify(summary));
    if (Object.values(summary).some((value) => typeof value === "number" && value !== 0 && value !== summary.textArtifactFiles) || artifactFindings.length > 0) {
      throw new Error("ROSTER_PII_SURFACE_CHECK_FAILED");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "ROSTER_PII_SURFACE_CHECK_FAILED");
  process.exitCode = 1;
});
