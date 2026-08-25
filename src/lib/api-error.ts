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
  ROSTER_FILE_TOO_LARGE: "名單檔案不可超過 4 MiB",
  ROSTER_FILE_INVALID: "名單檔案內容不正確，請檢查欄位、行數及工作表格式",
  ROSTER_FILE_NAME_INVALID: "名單檔案名稱不正確，請重新命名後再試",
  ROSTER_FORMAT_INVALID: "名單格式不正確，請使用 CSV 或 XLSX",
  ROSTER_CONTENT_TYPE_INVALID: "名單檔案類型與副檔名不一致",
  ROSTER_CONTENT_ENCODING_UNSUPPORTED: "名單上載不可使用額外壓縮編碼",
  ROSTER_CONTENT_LENGTH_INVALID: "名單檔案大小資料不正確，請重新選擇檔案",
  ROSTER_ENTITY_TYPE_INVALID: "名單角色不正確，請重新選擇學生或教師名單",
  ROSTER_MODE_INVALID: "名單匯入模式不正確，請重新選擇",
  ROSTER_ACKNOWLEDGEMENT_INVALID: "名單權限確認資料不正確，請重新預覽",
  ROSTER_OPERATION_ID_INVALID: "名單操作識別資料不正確，請重新預覽",
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
  CATALOG_INPUT_INVALID: "詞庫提交資料格式不正確，請檢查後再試",
  CATALOG_INPUT_TOO_LARGE: "詞庫提交資料太大，請縮減內容後再試",
  CATALOG_PAYLOAD_INVALID: "詞條內容格式不正確，請檢查所有欄位",
  CATALOG_PAYLOAD_REJECTED: "詞條未通過內容及干擾項驗證，請修正後再提交",
  CATALOG_QUESTION_PREVIEW_INVALID: "題目預覽設定不正確，請重新選擇方向後再試",
  CATALOG_QUESTION_PREVIEW_VALIDATION_FAILED: "詞條內容或干擾項未通過出題驗證，請先修正欄位",
  CATALOG_QUESTION_PREVIEW_UNAVAILABLE: "未有足夠三個安全干擾項，或所選方向尚未啟用",
  CATALOG_REASON_REQUIRED: "停用或重新啟用詞義前必須填寫理由",
  CATALOG_REASON_INVALID: "停用或重新啟用理由必須為 3 至 2,000 字；其他理由不可超過 2,000 字",
  CATALOG_SENSE_REQUIRED: "請先選擇要處理的詞義",
  CATALOG_SENSE_NOT_FOUND: "找不到這個詞義，請重新載入詞庫",
  CATALOG_SOURCE_ROW_NOT_FOUND: "來源詞條已經改變，請重新載入詞庫",
  CATALOG_NOT_READY: "正式詞庫尚未準備好，暫時不能提交修改",
  CATALOG_CHANGE_PENDING: "這個詞義已有待審核修改",
  CATALOG_PENDING_SENSE_CONFLICT: "已有相同詞義的新增申請等待審核",
  CATALOG_ALREADY_EXISTS: "相同詞義已經存在",
  CATALOG_ALREADY_RETIRED: "這個詞義已經停用",
  CATALOG_NOT_RETIRED: "這個詞義目前並非停用狀態",
  CATALOG_NOT_ACTIVE: "只有已啟用詞義才可以提交停用申請",
  CATALOG_REVISION_INVALID: "詞義版本資料不正確，請重新載入",
  CATALOG_REVISION_REQUIRED: "修改既有詞義前必須重新載入最新版本",
  CATALOG_REVISION_NOT_ALLOWED: "新增詞義不可帶有既有版本編號",
  CATALOG_REVISION_STALE: "詞義內容已被其他人更新，請重新載入後再提交",
  CATALOG_REQUEST_STALE: "審核項目已經改變，請重新載入",
  CATALOG_READ_STALE: "词库刚刚有更新，正在重新载入最新内容",
  CATALOG_IDENTITY_MISMATCH: "詞義身份與來源資料不一致，請重新載入",
  CATALOG_IDENTITY_CONFLICT: "詞義或詞頭身份已被其他修改使用，請重新載入",
  CATALOG_ENTRY_IDENTITY_CONFLICT: "詞頭身份與 lemma 不一致，請新增正確詞義後停用舊詞義",
  CATALOG_LEMMA_CHANGE_REQUIRES_NEW_SENSE: "既有詞義的 lemma 屬於穩定詞頭；請新增正確詞義後停用舊詞義",
  CATALOG_NO_ENABLED_DIRECTION: "至少要啟用一個出題方向才能批准",
  CATALOG_REVIEW_FORBIDDEN: "你沒有審核詞庫草稿的權限",
  CATALOG_SELF_REVIEW_FORBIDDEN: "不能審核自己提交的詞庫修改",
  CATALOG_FEEDBACK_TERM_REQUIRED: "請填寫建議加入的英文詞",
  CATALOG_FEEDBACK_TARGET_INVALID: "缺少詞語只可由全域入口提交；指定詞條請選擇對應問題類型",
  CATALOG_FEEDBACK_SENSE_REQUIRED: "這類問題必須由指定詞條的「報告問題」入口提交",
  CATALOG_FEEDBACK_QUERY_INVALID: "詞庫意見篩選或分頁設定不正確",
  CATALOG_FEEDBACK_CURSOR_INVALID: "詞庫意見分頁已失效，請由第一頁重新載入",
  CATALOG_FEEDBACK_MESSAGE_INVALID: "請用 3 至 2,000 字說明詞庫問題",
  CATALOG_FEEDBACK_SUGGESTION_INVALID: "修改建議不可超過 2,000 字",
  CATALOG_FEEDBACK_RESOLUTION_INVALID: "處理回覆必須為 3 至 2,000 字",
  CATALOG_FEEDBACK_STALE: "這項詞庫意見已被其他人處理，請重新載入",
  CATALOG_FEEDBACK_NOT_REVIEWABLE: "這項詞庫意見目前不能再處理",
  CATALOG_REQUEST_NOT_RETRYABLE: "這項申請目前不能重新提交",
  CATALOG_REQUEST_RETRY_NO_LONGER_APPLICABLE: "這項申請已因詞義狀態改變而不再適用，歷史紀錄仍會保留",
  CATALOG_REQUEST_ALREADY_SUPERSEDED: "這項申請已經建立修正版",
  CATALOG_REQUEST_RETRY_STALE: "正式詞條已更新，請重新開啟修正版並比較最新內容",
  CATALOG_REQUEST_RETRY_CONFLICT: "正式版本同原提案改過同一欄；請逐欄選擇後再提交",
  CATALOG_REQUEST_RETRY_RESOLUTION_INVALID: "修正版的欄位衝突選擇無效，請重新開啟",
  CATALOG_REQUEST_RETRY_PATCH_INVALID: "修正版內容同目前合併基線不一致，請重新開啟",
  CATALOG_STATUS_PAYLOAD_NOT_ALLOWED: "狀態申請不可同時修改詞條內容；請先提交內容修改並完成審核",
  CATALOG_BATCH_NOT_RETRYABLE: "這個批次目前不能建立修正版預覽",
  CATALOG_BATCH_ALREADY_SUPERSEDED: "這個批次已經建立修正版預覽",
  CATALOG_REVIEW_NOTE_REQUIRED: "拒絕草稿時必須填寫審核備註",
  CATALOG_REQUEST_NOT_FOUND: "找不到這項詞庫審核申請",
  CATALOG_APPROVED_REVISION_MISSING: "詞義缺少已批准內容，暫時不能重新啟用",
  CATALOG_APPROVED_REVISION_NOT_READY: "已批准內容不屬於目前可用詞庫版本，請先提交內容更新",
  CATALOG_BULK_DISABLED: "CSV 批量提交功能目前未啟用",
  CATALOG_HISTORY_DISABLED: "詞庫修改歷史目前未啟用",
  CATALOG_CSV_TOO_LARGE: "CSV 超過 4 MiB 上限",
  CATALOG_CSV_TOO_MANY_ROWS: "CSV 超過 200 行上限",
  CATALOG_CSV_EMPTY: "CSV 沒有資料行",
  CATALOG_CSV_UTF8_INVALID: "CSV 必須使用有效 UTF-8 編碼",
  CATALOG_CSV_HEADER_INVALID: "CSV 欄名與 word-catalog-v1 規格不符",
  CATALOG_CSV_HEADER_DUPLICATE: "CSV 有重複欄名",
  CATALOG_CSV_QUOTING_INVALID: "CSV 引號格式不正確",
  CATALOG_CSV_COLUMN_COUNT_INVALID: "CSV 某行欄數不正確",
  CATALOG_CSV_FORMULA_INVALID: "CSV 包含不安全的試算表公式開頭",
  CATALOG_FILENAME_INVALID: "CSV 檔名編碼不正確",
  CATALOG_CONTENT_TYPE_INVALID: "請以 text/csv 格式上載 CSV",
  CATALOG_EXPORT_SELECTION_INVALID: "請選擇 1 至 200 個不重複的詞義",
  CATALOG_EXPORT_SELECTION_STALE: "部分所選詞義已不存在，請重新載入詞庫",
  IDEMPOTENCY_KEY_INVALID: "操作識別碼格式不正確，請重新嘗試",
  IDEMPOTENCY_CONFLICT: "相同操作識別碼已用於不同內容，請重新嘗試",
  CATALOG_BATCH_NOT_FOUND: "找不到這個詞庫批次",
  CATALOG_BATCH_FORBIDDEN: "你沒有權限查看或修改這個詞庫批次",
  CATALOG_BATCH_STALE: "批次已被其他人更新，請重新載入",
  CATALOG_GROUP_STALE: "提案組已被其他人更新，請重新載入",
  CATALOG_BATCH_HAS_ERRORS: "批次仍有驗證錯誤，請修正 CSV 後重新預覽",
  CATALOG_BATCH_EMPTY: "批次沒有任何實際修改，毋須提交審核",
  CATALOG_BATCH_NEEDS_RESOLUTION: "批次仍有未處理的重複或衝突",
  CATALOG_BATCH_NOT_SUBMITTABLE: "批次目前不能提交審核",
  CATALOG_BATCH_NOT_REVIEWABLE: "批次目前不能審核",
  CATALOG_BATCH_NOT_FINALIZABLE: "批次尚未完成所有審核決定",
  CATALOG_BATCH_EXPIRED: "批次預覽已過期，請重新上載建立新預覽",
  CATALOG_BATCH_ALREADY_CLAIMED: "批次已由另一位審核者領取",
  CATALOG_REVIEW_CLAIM_REQUIRED: "請先領取這個批次才可審核",
  CATALOG_BATCH_REVIEW_REQUIRED: "CSV 批次子項必須由批次審核流程處理",
  CATALOG_BATCH_DEPENDENCY_STALE: "詞庫或其他待審申請已改變，請重新建立預覽",
  CATALOG_REVIEW_CLAIM_FORBIDDEN: "只有目前領取批次的審核者才可執行此操作",
  CATALOG_REVIEW_ACKNOWLEDGEMENT_REQUIRED: "批准前必須展開並確認全部修改欄位",
  CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE: "批次提交後內容已凍結；如要修改，請建立新預覽",
  CATALOG_CORRECTIVE_SOURCE_INVALID: "只可為已完成並已套用的批次建立修正預覽",
  CATALOG_CORRECTIVE_STALE: "原批次套用的詞條其後已改變，不能自動建立安全修正；請逐條處理",
  CATALOG_EXPORT_SELECTION_PENDING: "所選詞條包含等待審核的修改，請完成審核後再匯出",
  CATALOG_RESOLUTION_REASON_REQUIRED: "這種處理方式必須填寫理由",
  CATALOG_RESOLUTION_TARGET_REQUIRED: "所選處理方式需要有效的現有詞義",
  CATALOG_SOURCE_SELECTION_REQUIRED: "來源行內容不同；請明確採用其中一行，或實際編輯自訂最終提案",
  CATALOG_HISTORY_CURSOR_INVALID: "歷史分頁資料已失效，請重新載入",
  CATALOG_HISTORY_NOT_FOUND: "找不到這項詞庫歷史",
  CATALOG_HISTORY_FORBIDDEN: "你沒有權限查看這項詞庫歷史",
  CATALOG_HISTORY_FILTER_FORBIDDEN: "一般老師不能按其他使用者身份搜尋內部審核歷史",
  CATALOG_RATE_LIMITED: "詞庫操作過於頻繁，請稍後再試",
};

/** 根據 HTTP 狀態碼給出通用提示。 */
export function statusMessage(status: number): string {
  if (status === 401) return "登入狀態無效，請重新登入";
  if (status === 403) return "沒有權限訪問此頁面";
  if (status === 404) return "找不到請求的資源";
  if (status === 422) return "提交資料格式不正確，請檢查後再試";
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
