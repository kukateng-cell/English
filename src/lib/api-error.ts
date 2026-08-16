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
  const sourceMessage = body && typeof body.error === "string" && body.error.trim()
    ? body.error
    : (code && CODE_MESSAGES[code]) || statusMessage(res.status);
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
