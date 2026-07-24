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

/** 根据 HTTP 状态码给出通用提示。 */
export function statusMessage(status: number): string {
  if (status === 401) return "登录已过期，请重新登录";
  if (status === 403) return "没有权限访问此页面";
  if (status === 404) return "未找到请求的资源";
  if (status === 429) return "操作过于频繁，请稍后再试";
  if (status >= 500) return "服务器开小差了，请稍后重试";
  return "加载失败，请稍后重试";
}

/**
 * 从一个失败的 fetch Response 提取错误提示。
 * 优先读取 API 约定的 JSON `{ error: "..." }`，否则按状态码兜底。
 *
 * 注意：会消费 response body（内部调用 res.json()），
 * 因此只能在不再需要读取 res 时调用一次。
 */
export async function responseErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  if (body && typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }
  return statusMessage(res.status);
}

/**
 * 把 fetch 抛出的网络层错误转成友好提示。
 * 浏览器在网络失败时会抛 TypeError("Failed to fetch")。
 */
export function networkErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "网络连接失败，请检查网络后重试";
  return "加载失败，请稍后重试";
}
