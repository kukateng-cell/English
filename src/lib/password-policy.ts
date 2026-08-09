import bcrypt from "bcryptjs";

/** 全站建立／修改密码时共用的长度政策。登录页不应用此下限，以兼容旧账号。 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** bcrypt只处理首72个UTF-8 bytes；所有新密码必须在hash前集中检查。 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return "密码过长";
  if (bcrypt.truncates(password)) {
    return "密码的 UTF-8 编码不可超过 72 bytes";
  }
  return null;
}
