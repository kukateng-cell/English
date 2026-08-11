import type { Role } from "@/generated/prisma";

/**
 * 角色常量的运行时定义（单一来源）。
 *
 * Prisma 生成的 `Role` 只是字符串字面量联合类型（type），没有运行时成员，
 * 无法写 `Role.ADMIN`。这里集中提供运行时常量，让各处引用 `ROLES.ADMIN`
 * 等而非裸字符串 "ADMIN"，减少拼错风险、便于重构（改一处即全局生效）。
 */
export const ROLES = {
  STUDENT: "STUDENT",
  TEACHER: "TEACHER",
  ADMIN: "ADMIN",
} as const satisfies Record<string, Role>;

/** 全部角色（数组形式，便于 includes / 遍历 / 校验）。 */
export const ALL_ROLES: readonly Role[] = Object.values(ROLES);

/** 默认角色（未登录 / token 缺失 / 入参缺失时回退）。 */
export const DEFAULT_ROLE: Role = ROLES.STUDENT;

/** 判断任意值是否为合法 Role（用于校验 API 入参等）。 */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (ALL_ROLES as readonly string[]).includes(value)
  );
}

// 统一类型来源：消费方可直接 `import { ROLES, type Role } from "@/lib/roles"`
export type { Role } from "@/generated/prisma";

/**
 * 依角色回傳「它該去的首頁路徑」，用於越權存取時的重導向目標。
 * 唯一真相源，供 proxy.ts / Layout / RSC 共用。
 */
export function homePathFor(role: Role): string {
  if (role === ROLES.ADMIN) return "/admin";
  if (role === ROLES.TEACHER) return "/teacher";
  return "/";
}
