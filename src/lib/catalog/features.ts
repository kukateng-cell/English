import { isProductionRuntime } from "@/lib/production-config";

function enabled(name: "CATALOG_BULK_SUBMISSION_ENABLED" | "CATALOG_HISTORY_ENABLED"): boolean {
  const value = process.env[name];
  if (isProductionRuntime()) return value === "1" || value === "true";
  return value !== "0" && value !== "false";
}

export function catalogBulkSubmissionEnabled(): boolean {
  return enabled("CATALOG_BULK_SUBMISSION_ENABLED");
}

export function catalogHistoryEnabled(): boolean {
  return enabled("CATALOG_HISTORY_ENABLED");
}
