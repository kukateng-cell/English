import { randomInt } from "node:crypto";
import { passwordPolicyError } from "@/lib/password-policy";

const TEMPORARY_PASSWORD_CHARS =
  "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TEMPORARY_PASSWORD_LENGTH = 18;

export function generateTemporaryPassword(): string {
  let password = "";
  for (let index = 0; index < TEMPORARY_PASSWORD_LENGTH; index++) {
    password +=
      TEMPORARY_PASSWORD_CHARS[randomInt(TEMPORARY_PASSWORD_CHARS.length)];
  }
  const policyError = passwordPolicyError(password);
  if (policyError) {
    throw new Error(
      "Generated temporary password failed policy: " + policyError,
    );
  }
  return password;
}
