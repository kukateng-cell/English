/** A reserved login name never authorizes seed to take over an account. */
export function assertSeedAccountRole(existing: { role: string } | null, role: string, accountName: string): void {
  if (existing && existing.role !== role) throw new Error(`SEED_RESERVED_ACCOUNT_ROLE_CONFLICT: ${accountName}`);
}
