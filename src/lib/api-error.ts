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
  AUTH_REQUIRED: "尚未登录，请先登录",
  AUTH_BACKEND_UNAVAILABLE: "登录服务暂时无法使用，请稍后重试",
  RECENT_AUTH_REQUIRED: "最近的安全验证已过期，请重新输入密码",
  RECENT_AUTH_SESSION_INVALID: "登录状态需要重新验证，请重新登录",
  REAUTH_RATE_LIMITED: "验证尝试过于频繁，请稍后再试",
  PASSWORD_REQUIRED: "请输入密码",
  PASSWORD_INVALID: "密码不正确，请再试一次",
  CSRF_ORIGIN_INVALID: "安全验证失败，请刷新页面后再试",
  FORBIDDEN: "没有权限进行此操作",
  ROLE_FORBIDDEN: "没有权限进行此操作",
  REQUEST_INVALID: "请求资料不正确，请检查后再试",
  QUERY_INVALID: "查询条件不正确，请重新选择",
  PAYLOAD_TOO_LARGE: "资料太多，请缩小范围后再试",
  USER_NOT_FOUND: "找不到这个用户",
  CLASS_NOT_FOUND: "找不到这个班级",
  STUDENT_NOT_FOUND: "找不到这个学生",
  TEACHER_NOT_FOUND: "找不到这个教师",
  ACADEMIC_YEAR_NOT_FOUND: "找不到这个学年",
  CURRENT_YEAR_UNAVAILABLE: "目前学年暂时无法使用，请稍后再试",
  ACADEMIC_YEAR_READ_ONLY: "这个学年已经结束，只能查看，不能修改",
  ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR: "目标学年必须是下一个学年",
  ACADEMIC_YEAR_OVERLAP: "这个学年的日期与其他学年重叠",
  CLASS_IN_USE: "这个班级仍有学生或教师使用，暂时不能停用",
  ACCOUNT_OR_EMAIL_EXISTS: "账号或联络电邮已经被使用",
  CONTACT_EMAIL_INVALID: "联络电邮格式不正确",
  LEGAL_NAME_INVALID: "真实姓名不符合规定，请重新输入",
  NICKNAME_INVALID: "昵称不符合规定，请重新输入",
  RESET_TARGET_NOT_ACTIVE: "这个用户目前不能重设密码",
  RESET_TARGET_ROLE_FORBIDDEN: "只能为学生或教师重设密码",
  RESET_PRECONDITION_INVALID: "重设密码资料已失效，请重新操作",
  RESET_CREDENTIAL_STALE: "密码资料已经改变，请重新操作",
  RESET_ACTOR_CREDENTIAL_STALE: "你的登录状态已经改变，请重新登录",
  ACCOUNT_SUSPENDED: "账号已停权",
  ACCOUNT_REACTIVATED: "账号已恢复使用",
  LAST_ADMIN: "系统至少要保留一位管理员",
  SELF_SUSPEND_FORBIDDEN: "不能停权自己的管理员账号",
  SELF_DELETE_FORBIDDEN: "不能删除自己的管理员账号",
  ROSTER_BATCH_NOT_FOUND: "找不到这份名单预览",
  ROSTER_BATCH_EXPIRED: "这份名单预览已经过期，请重新验证",
  ROSTER_BATCH_STALE: "名单资料已经改变，请重新预览",
  ROSTER_BATCH_NOT_COMMITTABLE: "这份名单还有错误，修正后才能汇入",
  ROSTER_FILE_REQUIRED: "请选择名单文件",
  ROSTER_FILE_EMPTY: "名单文件没有资料",
  ROSTER_FORMAT_INVALID: "名单格式不正确，请使用 CSV 或 XLSX",
  ROSTER_HEADER_REQUIRED: "名单缺少必要栏位",
  ROSTER_HEADER_UNKNOWN: "名单包含无法识别的栏位",
  ROSTER_INPUT_INVALID: "名单格式不正确，请检查后再试",
  EXPORT_TOO_LARGE: "资料太多，暂时不能一次汇出",
  EXPORT_INPUT_INVALID: "汇出设定不正确，请重新选择",
  EXPORT_RATE_LIMITED: "汇出次数过多，请稍后再试",
  ANALYTICS_SCOPE_STALE: "资料刚刚有更新，请重新载入",
  RANGE_OUTSIDE_CURRENT_YEAR: "所选日期不在目前学年内",
  RANGE_INVALID: "日期范围不正确，请重新选择",
  STALE_PREVIEW: "预览资料已经改变，请重新预览",
  ACCESS_UPDATE_STALE: "教师权限已经改变，请重新载入后再保存",
  TEACHER_QUERY_STALE: "教师名单已经改变，请重新载入",
  ADMIN_USER_QUERY_STALE: "用户名单已经改变，请重新载入",
  CURRENT_YEAR_REQUIRED: "请先选择目前学年",
  ACADEMIC_YEAR_REQUIRED: "请选择学年",
  CLASS_INVALID: "班级资料不正确，请重新选择",
  GRADE_INVALID: "年级资料不正确，请重新选择",
  ROLE_INVALID: "用户角色不正确，请重新选择",
  STUDENT_YEAR_GRADE_REQUIRED: "请为学生选择学年及年级",
  GRADE_CLASS_REQUIRED: "请同时选择年级及班别，或选择未分班",
  PROMOTION_INPUT_INVALID: "升级资料不正确，请检查后再试",
  PROMOTION_DISPOSITION_REQUIRED: "请先为每位学生选择安排方式",
  PROMOTION_DISPOSITION_INVALID: "学生安排方式不正确，请重新选择",
  TARGET_CLASS_REQUIRED: "请选择目标班别",
  TARGET_CLASS_NOT_FOUND: "找不到目标班别",
  YEAR_NOT_SUCCESSOR: "目标学年必须是下一个学年",
  YEAR_STATE_INVALID: "学年状态不适合这个操作",
  COVERAGE_TEACHER: "请先确认每个班级的教师查看权限",
  MISSING_TRANSITION_OUTCOME: "有学生还没有完成升班安排",
  IMMEDIATE_EFFECT_ACK_REQUIRED: "请先确认这项权限会即时生效",
  ROSTER_STATE_MISSING: "名单服务暂时无法使用，请稍后再试",
};

/** 根据 HTTP 状态码给出通用提示。 */
export function statusMessage(status: number): string {
  if (status === 401) return "登录状态无效，请重新登录";
  if (status === 403) return "没有权限访问此页面";
  if (status === 404) return "找不到请求的资源";
  if (status === 422) return "请先设置新密码后继续";
  if (status === 429) return "操作过于频繁，请稍后再试";
  if (status >= 500) return "服务器暂时出错，请稍后再试";
  return "加载失败，请稍后再试";
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
  if (error instanceof TypeError) return "网络连接失败，请检查网络后重试";
  return "加载失败，请稍后重试";
}
