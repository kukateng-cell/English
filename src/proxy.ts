import { NextResponse } from "next/server";
import type { NextRequest, NextProxy } from "next/server";
import { getToken } from "next-auth/jwt";
import { ROLES, DEFAULT_ROLE, homePathFor, type Role } from "@/lib/roles";

/**
 * 路由级角色保护（纵深防御，与各 API 内的 requireRole 互为补充）。
 *
 * Next.js 16 起，`middleware.ts` 已废弃，改为 `proxy.ts`（函数名也由
 * `middleware` 改为 `proxy`）。运行行为、matcher、NextRequest/NextResponse
 * API 与旧版 middleware 完全一致，只是换了文件约定。
 *
 * 规则：
 *  - /admin/*           → 仅 ADMIN
 *  - /teacher/*         → TEACHER 或 ADMIN（管理员可查看教师视角）
 *  - /、/study /units    → 任意已登录用户（首页按角色处理）
 *  - /api/admin/*        → 仅 ADMIN（API 请求返回 403 JSON，而非跳转）
 *  - /api/teacher/*      → TEACHER 或 ADMIN
 *  - /api/study /units   → 任意已登录用户
 *  - 其余路径（/, /login, /api/auth/* 等）→ 放行
 */
const proxy: NextProxy = async (req: NextRequest) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const role = (token?.role as Role | undefined) ?? DEFAULT_ROLE;
  // 首次登入強制改密碼：seed 学生账号预设 true，重设密码后变 false。
  const mustChangePassword = token?.mustChangePassword === true;

  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  const isTeacherArea =
    pathname.startsWith("/teacher") || pathname.startsWith("/api/teacher");
  const isStudentArea =
    pathname === "/" ||
    pathname.startsWith("/study") ||
    pathname.startsWith("/units") ||
    pathname.startsWith("/api/study") ||
    pathname.startsWith("/api/units");
  const isStudentOnlyArea =
    pathname.startsWith("/words") ||
    pathname.startsWith("/stats") ||
    pathname.startsWith("/api/words") ||
    pathname.startsWith("/api/student");
  // 重设密码区：必须登入，但不受 mustChangePassword 闸门拦截（否则死循环）。
  const isResetArea =
    pathname === "/reset-password" || pathname.startsWith("/api/reset-password");

  const needsAuth = isAdminArea || isTeacherArea || isStudentArea || isStudentOnlyArea || isResetArea;
  if (!token && needsAuth) {
    if (isApi) {
      // 未登入的 API 請求：回 401（語意比 403 準確；各 route 內仍會再驗一次）
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // 未登入的頁面請求：重導至登入頁，並帶上 callbackUrl 以便登入後返回原頁。
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?callbackUrl=${encodeURIComponent(
      pathname + (req.nextUrl.search || ""),
    )}`;
    return NextResponse.redirect(loginUrl);
  }

  // 首次登入強制改密碼闸门：mustChangePassword=true 时，只放行重设密码区。
  // 其余页面 → 重导到 /reset-password；API → 422（前端可据此提示）。
  // （/api/auth/* 已被 matcher 排除，登出等流程不受影响。）
  if (token && mustChangePassword && !isResetArea) {
    if (isApi) {
      return NextResponse.json(
        { error: "請先設定新密碼後繼續", mustChangePassword: true },
        { status: 422 },
      );
    }
    const resetUrl = req.nextUrl.clone();
    resetUrl.pathname = "/reset-password";
    resetUrl.search = `?callbackUrl=${encodeURIComponent(
      pathname + (req.nextUrl.search || ""),
    )}`;
    return NextResponse.redirect(resetUrl);
  }

  // admin 区：仅 ADMIN
  if (isAdminArea && role !== ROLES.ADMIN) {
    return deny(req, isApi, homePathFor(role));
  }

  // teacher 区：TEACHER 或 ADMIN
  if (isTeacherArea && role !== ROLES.TEACHER && role !== ROLES.ADMIN) {
    return deny(req, isApi, homePathFor(role));
  }

  if (isStudentOnlyArea && role !== ROLES.STUDENT) {
    return deny(req, isApi, homePathFor(role));
  }

  // The root is the student dashboard. Other roles keep their existing home.
  if (pathname === "/" && role !== ROLES.STUDENT) {
    return deny(req, isApi, homePathFor(role));
  }

  return NextResponse.next();
};

export default proxy;

/** 页面请求 → 重定向；API 请求 → 返回 JSON 错误。 */
function deny(req: NextRequest, isApi: boolean, redirectTo: string): NextResponse {
  if (isApi) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = req.nextUrl.clone();
  url.pathname = redirectTo;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // 排除静态资源、NextAuth 自身端点与 favicon；其余交给上面逻辑判断。
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
