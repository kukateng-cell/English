import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

if (process.env.CONFIRM_LEDGER_BRIDGE_CONTRACT !== "REMOVE_LEGACY_BRIDGE") {
  throw new Error(
    "Ledger contract requires CONFIRM_LEDGER_BRIDGE_CONTRACT=REMOVE_LEGACY_BRIDGE",
  );
}
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required");

const pool = new pg.Pool({
  connectionString: process.env.MIGRATE_URL,
  max: 1,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});

try {
  const state = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260808010000_harden_review_event_ledger'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS bridge_installed,
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260809019000_atomic_contract_legacy_review_bridge'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS atomic_contract_applied,
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260809020000_contract_legacy_review_bridge'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS compatibility_contract_applied
  `);
  const row = state.rows[0];
  if (row.atomic_contract_applied && row.compatibility_contract_applied) {
    console.log("Ledger contract already applied");
  } else {
    if (!row.bridge_installed) {
      throw new Error(
        "Cannot contract ledger bridge before the expand migration is installed",
      );
    }
    const recent = await pool.query(`
      SELECT COUNT(*)::integer AS count
      FROM "ReviewEvent"
      WHERE "eventKind" = 'LEGACY_BRIDGE'
        AND "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '30 minutes'
    `);
    if (Number(recent.rows[0].count) > 0) {
      throw new Error(
        `Refusing ledger bridge contract: ${recent.rows[0].count} legacy writes observed in the last 30 minutes`,
      );
    }
    console.log("Ledger contract quiet-window check passed");
  }
} finally {
  await pool.end();
}
