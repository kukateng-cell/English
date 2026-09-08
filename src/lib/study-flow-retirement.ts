import { NextResponse } from "next/server";

export const STUDY_FLOW_RETIRED = {
  code: "STUDY_FLOW_RETIRED",
  error: "學習流程已更新，請重新載入頁面",
} as const;

export function studyFlowRetiredResponse(): NextResponse {
  return NextResponse.json(STUDY_FLOW_RETIRED, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
