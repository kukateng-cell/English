import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import type { Role } from "@/generated/prisma";

/**
 * 路由级角色保护（纵深防御，与各 API 内的 requireRole 互为补充）。
 *
 * 规则：
 *  - /admin/*           → 仅 ADMIN
 *  - /teacher/*         → TEACHER 或 ADMIN（管理员可查看教师视角）
 *  - /study /units       → 任意已登录用户
 *  - /api/admin/*        → 仅 ADMIN（API 请求返回 403 JSON，而非跳转）
 *  - /api/teacher/*      → TEACHER 或 ADMIN
 *  - /api/study /units   → 任意已登录用户
 *  - 其余路径（/, /login, /api/auth/*, /api/seed-roles 等）→ 放行
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const role = (token?.role as Role | undefined) ?? "STUDENT";

  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  const isTeacherArea =
    pathname.startsWith("/teacher") || pathname.startsWith("/api/teacher");
  const isStudentArea =
    pathname.startsWith("/study") ||
    pathname.startsWith("/units") ||
    pathname.startsWith("/api/study") ||
    pathname.startsWith("/api/units");

  const needsAuth = isAdminArea || isTeacherArea || isStudentArea;
  if (!token && needsAuth) {
    return deny(req, isApi, "/login");
  }

  // admin 区：仅 ADMIN
  if (isAdminArea && role !== "ADMIN") {
    return deny(req, isApi, homeOf(role));
  }

  // teacher 区：TEACHER 或 ADMIN
  if (isTeacherArea && role !== "TEACHER" && role !== "ADMIN") {
    return deny(req, isApi, homeOf(role));
  }

  return NextResponse.next();
}

/** 根据角色返回「它该去」的首页，用于越权访问时的重定向目标。 */
function homeOf(role: Role): string {
  if (role === "ADMIN") return "/admin";
  if (role === "TEACHER") return "/teacher";
  return "/study";
}

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
