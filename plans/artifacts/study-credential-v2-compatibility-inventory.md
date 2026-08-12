# Study Credential v2 Compatibility Inventory

> 狀態：已完成 local／internal verification；未當作 production migration 或 binary downgrade approval
> 日期：2026-08-12
> Branch：`codex/retrieval-first-learning-stream-v2`
> Migration baseline：`cc7fd19`

## 1. Scope and safety boundary

This artifact records the code-path inventory, expand-schema compatibility review and a
read-only profile of the local PostgreSQL database. It does not access production, create a
student cohort, enable research exposure, run `npm run db:contract`, or claim that a schema
downgrade is possible.

The repeatable database gate is
`npm run check:study-credential-v2`. It emits aggregate counts only; it does not print user IDs,
word IDs, credentials, operation IDs or answer keys. The lineage-specific gate remains
`node scripts/check-study-lineage-compatibility.mjs`.

## 2. Runtime inventory

| Concern | V1 path / invariant | V2 path / invariant | Evidence |
|---|---|---|---|
| Item identity | `StudySessionItem` lookup and the unchanged unique `(sessionId, wordId)` | `StudyStreamItem` lookup by `(sessionId, streamItemKey)` and opaque `streamItemId`; same-word items are separate rows | `src/app/api/study/route.ts`, `src/lib/study-stream/server.ts`, Prisma schema and migration index scan |
| Credential | Word/session item nonce and legacy credential lineage | Stream-item credential digest, bounded digest-only lineage and short-lived successor grants | `src/lib/study-session-server.ts`, `src/lib/study-stream/server.ts`, `20260812040000_add_stream_credential_lineage` |
| Checkpoint / outbox | V1 decoder and `study:*` storage keys remain in the legacy study page | Versioned user-scoped V2 pointer and `english:study-stream-v2:*` outbox/checkpoint keys; corrupt rows fail closed | `src/app/(student)/study/page.tsx`, `src/lib/checkpoint.ts`, `src/lib/study-stream/outbox.ts` |
| API dispatch | `/api/study` remains the V1 route and retains its session/nonce validator | `/api/study/stream`, `/api/study/actions`, `/api/study/sessions/renew` are typed V2 boundaries | Route files and Phase 0 handoff addendum |
| Review ledger writers | `applyReviewEvent` writes V1 `ReviewEvent` plus the global receipt bridge | `processObjectiveAnswer` writes only provenance-complete V2 objective `ReviewEvent` rows; self-rating writes `StudyEncounter` only | `src/app/api/study/route.ts`, `src/lib/study-stream/server.ts` |
| Projections / jobs | Legacy review and StudyDay continuity remains available | Metrics, unit summary and leaderboard require explicit V2 objective provenance where applicable | `src/lib/student-metrics.ts`, `src/lib/leaderboard.ts`, `src/app/api/study/insights/route.ts` |
| Assignment | V1 is the production default | V2 is deny-by-default and only accepts `STUDY_V2_INTERNAL_USER_IDS`; no student cohort or research assignment exists | `src/lib/study-stream/assignment.ts`, `.env.example`, production config checks |

The static search used to review this table was:

```bash
rg -n "sessionId.*wordId|wordId.*sessionId|nonce|checkpoint|outbox|ReviewEvent|OperationReceipt|StudyStreamItem|EvidenceObligation" src scripts prisma tests
```

The search confirmed that the only V2 item identity implementation is `StudyStreamItem`; the
legacy composite unique remains confined to V1 schema, V1 route/session helpers and their
regression fixtures. No cleanup or analytics path treats a V2 item as a V1 session-word key.

## 3. Local PostgreSQL profile

Captured with the read-only gates on 2026-08-12:

| Profile | Result |
|---|---:|
| Database size at migration preflight | 37 MB |
| Estimated legacy `ReviewEvent` backfill rows | 0 (already expanded locally) |
| `StudySessionItem` rows / relation size | 51,787 / 20 MB |
| Legacy items unused / renewed / source-linked | 51,028 / 440 / 596 |
| `StudyStreamItem` rows | 8 (6 learning cards, 2 probes; 3 open) |
| Sessions by flow | V1: 4,039; V2: 4 |
| Same-session same-word V2 groups | 1; maximum 3 item rows in one group |
| Global receipts | 735 (V1: 724; V2: 11) |
| `ReviewEvent` rows without a receipt | 0 |
| Incomplete V2 provenance rows | 0 |
| Legacy `(sessionId, wordId)` index | present |
| V2 `(sessionId, streamItemKey)` index | present |
| Credential lineage compatibility gaps | 0 total; 0 ambiguous; 0 unresolved |

This is the final post-E2E local profile captured on 2026-08-12; local regression workflows add
test rows, so counts are not a production snapshot. The profile is evidence for query and index
behavior only, not a production size estimate. `scripts/check-production-migration-safety.mjs` still blocks an unplanned large
backfill, and a production-like profile plus an approved staged rollout is required before any
formal production migration.

## 4. Expand and rollback compatibility matrix

| Code / schema point | Can run after expand? | Rollback classification | Reason / evidence |
|---|---|---|---|
| `cc7fd19` pre-expand binary | Do not use | Not an approved rollback target | It predates the global `OperationReceipt` bridge. Even if PostgreSQL can ignore additive columns, new V1 writes would not establish the receipt contract required when the current build is restored. |
| `79338e3` receipt-aware V1-default build | Yes for feature-off V1 operation | Approved code rollback target after assignment is disabled | It retains `/api/study`, uses the expand schema and global receipt bridge, and does not require a destructive schema downgrade. V2 tables are additive and V2 assignment remains off unless explicitly allowlisted. |
| `de48495` current build | Yes | Forward/internal validation target | It is the current V2 implementation with credential lineage, checkpoint repair, V1 bridge and all current reliability fixes. |
| `npm run db:contract` / contract migrations | Separate destructive gate | Never part of normal code rollback | Requires explicit user confirmation, snapshot/backup and an independent compatibility window; it has not been executed. |

Expand changes were reviewed as follows:

- `Review.revision` has a default; new `ReviewEvent` provenance columns are nullable and existing
  rows are classified as `LEGACY_UNKNOWN` / `v1` during expand;
- `StudySession` V2 fields have safe defaults or are nullable;
- V2 tables and indexes are additive; the V1 composite unique is untouched;
- `credentialLineage` is nullable JSONB and stores only bounded digest grants, so old binaries
  can ignore the field, while the approved rollback binary is still the receipt-aware build;
- no code path converts an unproven V2 outbox action into a V1 word action.

The matrix is a static code/schema review plus V1 regression and temporary-schema migration
evidence. No old binary was deployed against a real production database, and no schema downgrade
was attempted.

## 5. Backfill decision

The expand migration performs the bounded legacy provenance and receipt backfill as an
idempotent set-based operation. A second application-level batch writer is deliberately not
introduced: it would create a competing provenance writer and could race the ledger bridge.
`migrate-deploy.mjs` runs checksum and row-size preflight before migration, applies PostgreSQL
lock/statement timeouts, stops on a non-zero migration status, and runs lineage validation after
deployment. The inventory gate then checks receipt gaps, V2 provenance gaps, duplicate candidate
shape and both identity indexes.

For a production database above the configured row limit, the preflight must stop and an
approved staged/batched migration plan with progress and failure evidence must be prepared before
retrying. That production gate is intentionally still open.

## 6. Validation commands

```bash
npx prisma migrate status
npm run check:production-config
npm run check:study-credential-v2
node scripts/check-study-lineage-compatibility.mjs
npm run test:db
npm run test:db:stream-v2
npm run test:migrations
npm run test:migrations:contract
npm run test:migration-checksums
```

Migration, inventory, lineage, database and migration-replay commands above passed locally on
2026-08-12, with the database commands run against the local PostgreSQL instance using the
repository's required escalated read/write permission. `npm run check:production-config` correctly
rejected the default local environment because production secrets are absent; a non-persistent
shape-only synthetic environment passed. The temporary-schema contract suite did not run
`npm run db:contract`.

## 7. Open external gates

- production database profile, backup/snapshot and formal migration window;
- old-binary deployment rehearsal in a production-like environment;
- long production observation window and agreed alert thresholds;
- real student pilot, parent/guardian permission and student assent;
- any legacy contract cleanup or schema retirement.
