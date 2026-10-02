import { responseErrorMessage } from "@/lib/api-error";
import {
  catalogIssuePresentation,
  type CatalogStructuredIssue,
} from "@/lib/catalog/teacher-presentation";
import { CATALOG_STRUCTURED_ISSUE_VERSION } from "@/lib/catalog/validation-issue-contract";

type Translate = (value: string) => string;

function validationIssues(value: unknown): CatalogStructuredIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.code !== "string") return [];
    return [
      {
        code: row.code,
        field: typeof row.field === "string" ? row.field : null,
        direction:
          row.direction === "EN_TO_ZH" || row.direction === "ZH_TO_EN"
            ? row.direction
            : null,
        severity: row.severity === "WARNING" ? "WARNING" : "ERROR",
      } satisfies CatalogStructuredIssue,
    ];
  });
}

export async function catalogValidationResponseErrorMessage(
  response: Response,
  translate: Translate,
): Promise<string> {
  try {
    const body = (await response.clone().json()) as {
      issues?: unknown;
      structuredIssueVersion?: unknown;
    };
    const issues = (
      body.structuredIssueVersion === CATALOG_STRUCTURED_ISSUE_VERSION
        ? validationIssues(body.issues)
        : []
    ).filter(
      (issue) => issue.severity === "ERROR",
    );
    if (issues.length) {
      return issues
        .map((issue) => {
          const copy = catalogIssuePresentation(issue);
          const context = copy.directionLabel
            ? `${translate(copy.directionLabel)} · ${translate(copy.fieldLabel)}`
            : translate(copy.fieldLabel);
          return `${context}：${translate(copy.reason)} ${translate(copy.fix)}`;
        })
        .join("\n");
    }
  } catch {
    // Fall through to the normal API error mapping for non-validation bodies.
  }
  return responseErrorMessage(response, translate);
}
