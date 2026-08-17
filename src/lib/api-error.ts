/**
 * 把 fetch 失败转成对用户友好的中文提示。
 *
 * 前端各页面拉取数据时，统一用这套工具：
 *  - HTTP 非 2xx：优先读 API 约定的 JSON `{ error }`，否则按状态码兜底；
 *  - 网络层异常（fetch 直接抛错，通常是离线 / DNS / 连接被拒）：给出网络提示。
 *
 * 这样 401 / 403 / 500 / 断网等情形都能在界面上明确反馈，
 * 而不是让用户对着空数据或一直转圈的 loading 发呆。
 */

const CODE_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "尚未登入，請先登入",
  AUTH_BACKEND_UNAVAILABLE: "登入服務暫時無法使用，請稍後重試",
  RECENT_AUTH_REQUIRED: "最近的安全驗證已過期，請重新輸入密碼",
  RECENT_AUTH_SESSION_INVALID: "登入狀態需要重新驗證，請重新登入",
  REAUTH_RATE_LIMITED: "驗證嘗試過於頻繁，請稍後再試",
  PASSWORD_REQUIRED: "請輸入密碼",
  PASSWORD_INVALID: "密碼不正確，請再試一次",
  CSRF_ORIGIN_INVALID: "安全驗證失敗，請重新整理頁面後再試",
  FORBIDDEN: "沒有權限進行此操作",
  ROLE_FORBIDDEN: "沒有權限進行此操作",
  REQUEST_INVALID: "請求資料不正確，請檢查後再試",
  QUERY_INVALID: "查詢條件不正確，請重新選擇",
  PAYLOAD_TOO_LARGE: "資料太多，請縮小範圍後再試",
  DIRECTORY_TOO_LARGE: "學生人數太多，請先按年級或班別篩選後再載入名單",
  TEACHER_DIRECTORY_TOO_LARGE: "學生人數太多，請先按年級或班別篩選後再載入名單",
  ANALYTICS_SCOPE_TOO_LARGE: "學生人數太多，請先按年級或班別篩選後再載入分析",
  RATE_LIMIT_BACKEND_UNAVAILABLE: "限流服務暫時無法使用，請稍後再試",
  AUDIT_BACKEND_UNAVAILABLE: "記錄服務暫時無法使用，報告未能匯出，請稍後再試",
  USER_NOT_FOUND: "找不到這個用戶",
  CLASS_NOT_FOUND: "找不到這個班級",
  STUDENT_NOT_FOUND: "找不到這個學生",
  TEACHER_NOT_FOUND: "找不到這個教師",
  ACADEMIC_YEAR_NOT_FOUND: "找不到這個學年",
  CURRENT_YEAR_UNAVAILABLE: "目前學年暫時無法使用，請稍後再試",
  ACADEMIC_YEAR_READ_ONLY: "這個學年已經結束，只能查看，不能修改",
  ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR: "目標學年必須是下一個學年",
  ACADEMIC_YEAR_OVERLAP: "這個學年的日期與其他學年重疊",
  CLASS_IN_USE: "這個班級仍有學生或教師使用，暫時不能停用",
  ACCOUNT_OR_EMAIL_EXISTS: "帳號或聯絡電郵已經被使用",
  STUDENT_NUMBER_CONFLICT: "這個學號在所選學年／班別已被使用，請改用其他學號",
  CONTACT_EMAIL_INVALID: "聯絡電郵格式不正確",
  LEGAL_NAME_INVALID: "真實姓名不符合規定，請重新輸入",
  NICKNAME_INVALID: "暱稱不符合規定，請重新輸入",
  RESET_TARGET_NOT_ACTIVE: "這個用戶目前不能重設密碼",
  RESET_TARGET_ROLE_FORBIDDEN: "只能為學生或教師重設密碼",
  RESET_PRECONDITION_INVALID: "重設密碼資料已失效，請重新操作",
  RESET_PRECONDITION_UNAVAILABLE: "目前無法準備重設密碼，請稍後再試",
  RESET_CREDENTIAL_STALE: "密碼資料已經改變，請重新操作",
  RESET_ACTOR_CREDENTIAL_STALE: "你的登入狀態已經改變，請重新登入",
  ACCOUNT_SUSPENDED: "帳號已停權",
  ACCOUNT_REACTIVATED: "帳號已恢復使用",
  LAST_ADMIN: "系統至少要保留一位管理員",
  SELF_SUSPEND_FORBIDDEN: "不能停權自己的管理員帳號",
  SELF_DELETE_FORBIDDEN: "不能刪除自己的管理員帳號",
  ROSTER_BATCH_NOT_FOUND: "找不到這份名單預覽",
  ROSTER_BATCH_EXPIRED: "這份名單預覽已經過期，請重新驗證",
  ROSTER_BATCH_STALE: "名單資料已經改變，請重新預覽",
  ROSTER_BATCH_NOT_COMMITTABLE: "這份名單還有錯誤，修正後才能匯入",
  ROSTER_FILE_REQUIRED: "請選擇名單檔案",
  ROSTER_FILE_EMPTY: "名單檔案沒有資料",
  ROSTER_FORMAT_INVALID: "名單格式不正確，請使用 CSV 或 XLSX",
  ROSTER_HEADER_REQUIRED: "名單缺少必要欄位",
  ROSTER_HEADER_UNKNOWN: "名單包含無法識別的欄位",
  ROSTER_INPUT_INVALID: "名單格式不正確，請檢查後再試",
  EXPORT_TOO_LARGE: "資料太多，暫時不能一次匯出",
  EXPORT_INPUT_INVALID: "匯出設定不正確，請重新選擇",
  EXPORT_RATE_LIMITED: "匯出次數過多，請稍後再試",
  ANALYTICS_SCOPE_STALE: "資料剛剛有更新，請重新載入",
  RANGE_OUTSIDE_CURRENT_YEAR: "所選日期不在目前學年內",
  RANGE_INVALID: "日期範圍不正確，請重新選擇",
  STALE_PREVIEW: "預覽資料已經改變，請重新預覽",
  ACCESS_UPDATE_STALE: "教師權限已經改變，請重新載入後再保存",
  TEACHER_QUERY_STALE: "教師名單已經改變，請重新載入",
  ADMIN_USER_QUERY_STALE: "用戶名單已經改變，請重新載入",
  CURRENT_YEAR_REQUIRED: "請先選擇目前學年",
  ACADEMIC_YEAR_REQUIRED: "請選擇學年",
  CLASS_INVALID: "班級資料不正確，請重新選擇",
  GRADE_INVALID: "年級資料不正確，請重新選擇",
  ROLE_INVALID: "用戶角色不正確，請重新選擇",
  STUDENT_YEAR_GRADE_REQUIRED: "請為學生選擇學年及年級",
  GRADE_CLASS_REQUIRED: "請同時選擇年級及班別，或選擇未分班",
  PROMOTION_INPUT_INVALID: "升級資料不正確，請檢查後再試",
  PROMOTION_DISPOSITION_REQUIRED: "請先為每位學生選擇安排方式",
  PROMOTION_DISPOSITION_INVALID: "學生安排方式不正確，請重新選擇",
  TARGET_CLASS_REQUIRED: "請選擇目標班別",
  TARGET_CLASS_NOT_FOUND: "找不到目標班別",
  YEAR_NOT_SUCCESSOR: "目標學年必須是下一個學年",
  YEAR_STATE_INVALID: "學年狀態不適合這個操作",
  COVERAGE_TEACHER: "請先確認每個班級的教師查看權限",
  MISSING_TRANSITION_OUTCOME: "有學生還沒有完成升班安排",
  IMMEDIATE_EFFECT_ACK_REQUIRED: "請先確認這項權限會即時生效",
  ROSTER_STATE_MISSING: "名單服務暫時無法使用，請稍後再試",
};

/** 根據 HTTP 狀態碼給出通用提示。 */
export function statusMessage(status: number): string {
  if (status === 401) return "登入狀態無效，請重新登入";
  if (status === 403) return "沒有權限訪問此頁面";
  if (status === 404) return "找不到請求的資源";
  if (status === 422) return "請先設定新密碼後繼續";
  if (status === 429) return "操作過於頻繁，請稍後再試";
  if (status >= 500) return "伺服器暫時出錯，請稍後再試";
  return "載入失敗，請稍後再試";
}

export interface ApiErrorDetails {
  code: string | null;
  message: string;
}

function translateMessage(message: string, translate?: (text: string) => string) {
  return translate ? translate(message) : message;
}

/**
 * 从一个失败的 fetch Response 提取错误提示。
 * 优先读取 API 约定的 JSON `{ error: "..." }`，否则按状态码兜底。
 *
 * 注意：会消费 response body（内部调用 res.json()），
 * 因此只能在不再需要读取 res 时调用一次。
 */
export async function responseErrorDetails(
  res: Response,
  translate?: (text: string) => string,
): Promise<ApiErrorDetails> {
  const body = await res.json().catch(() => null);
  const code = body && typeof body.code === "string" ? body.code : null;
  const sourceMessage = (code && CODE_MESSAGES[code])
    || (body && typeof body.error === "string" && body.error.trim() ? body.error : statusMessage(res.status));
  return { code, message: translateMessage(sourceMessage, translate) };
}

export async function responseErrorMessage(
  res: Response,
  translate?: (text: string) => string,
): Promise<string> {
  return (await responseErrorDetails(res, translate)).message;
}

/**
 * 把 fetch 抛出的网络层错误转成友好提示。
 * 浏览器在网络失败时会抛 TypeError("Failed to fetch")。
 */
export function networkErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "網絡連線失敗，請檢查網絡後重試";
  return "載入失敗，請稍後重試";
}
