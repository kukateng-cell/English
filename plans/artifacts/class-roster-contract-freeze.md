# Class roster Revision 3 contract freeze

Freeze date: 2026-08-15

This artifact is the implementation-level index for the reviewed Revision 3
plan. It records the stable names used by the application and tests; a code or
schema change that alters one of these contracts must update the plan first.

Implementation note (local only, 2026-08-15): the contract is implemented on
`codex/class-roster-import-and-access-control` through normal migrations ending at
`20260815027000_roster_revision3_set_based_final_state`. Fresh replay,
checksums, raw invariant/lifecycle/auth/reset suites, build, and the complete
disposable admin roster workflow (3 default Playwright tests, plus isolated fresh-DB 500-row import/promotion boundary and 5,000/5,001 activation cap smokes) have passed. The 5,000 activation commit completed in 3,211ms total with a 3,185ms `Server-Timing` transaction. Contract
migrations, production configuration, and the remaining large-fixture,
accessibility/performance gates are intentionally not claimed here.

## Canonical identities

- `User.accountName` is the student-number/login identifier (the physical
  column may remain mapped to legacy `email` during expand).
- `User.contactEmail` is optional and is not used for login or password
  recovery in this feature.
- Students require `StudentProfile.legalName`, `nickname`, and
  `nicknameNormalized`; public student DTOs expose nickname only.
- Grades are `JUNIOR_1 | JUNIOR_2 | JUNIOR_3 | SENIOR_1 | SENIOR_2 | SENIOR_3`.
  Class codes are `A` through `H`.

## Stable API/error vocabulary

Mutation routes require an active role, per-session recent-auth grant, and the
same-origin Origin plus CSRF double-submit check. Responses use JSON
`{code: string}` with `no-store`; validation and stale errors never contain SQL,
Prisma, parser, or filesystem details. Core codes include:
`CSRF_ORIGIN_INVALID`, `AUTH_REQUIRED`, `RECENT_AUTH_REQUIRED`,
`STALE_PREVIEW`, `ACADEMIC_YEAR_REQUIRED`, `ACADEMIC_YEAR_READ_ONLY`,
`CLASS_NOT_FOUND`, `ROSTER_BATCH_NOT_FOUND`, `ROSTER_BATCH_EXPIRED`,
`ROSTER_BATCH_TERMINAL`, `ROSTER_BATCH_NOT_COMMITTABLE`, `EXPORT_TOO_LARGE`,
and `EXPORT_RATE_LIMITED`.

## Import headers and merge actions

The versioned templates are `student-roster-v1` and `teacher-roster-v1`.
Canonical headers are:

- Student: `accountName,legalName,nickname,grade,classCode,contactEmail`.
- Teacher: `accountName,legalName,contactEmail,classAccess,resetPasswordAccess`.

Aliases are accepted only at parse time and are canonicalised before duplicate
checks. Preview actions are `CREATE | UPDATE | UNCHANGED | ERROR` and include
row number, stable error `{code,row,field,messageKey}`, and field-level diff.
Student class blank means unassigned for a new selected-year enrollment and
preserve for an existing same-grade merge; `UNASSIGNED` explicitly clears it.
Teacher access uses `GRADE:CLASS` values separated by `|`; reset access must be
a subset of view access. Merge does not change passwords or roles.

## Export allowlist

Students: `accountName, legalName, nickname, grade, classCode, contactEmail,
status, mustChangePassword, createdAt`.

Teachers: `accountName, legalName, contactEmail, status, classAccess,
resetPasswordAccess, createdAt`.

`academicYear` is a filter, not an export field. Password hashes, temporary
passwords, token/session values, audit digests, and internal IDs are never
exported. Student rows use an INNER JOIN to the explicitly selected year;
teacher access is a selected-year LEFT JOIN. CSV is neutralised RFC 4180 with
UTF-8 BOM; XLSX values are typed strings.

## HMAC and staging lifecycle

`SECURITY_AUDIT_HMAC_SECRET` (at least 32 bytes) and
`SECURITY_AUDIT_HMAC_KEY_ID` are separate from the JWT secret. Local defaults
are development-only; production configuration fails closed when either is
missing. New audit writes carry actor/subject/IP pseudonyms and key version;
legacy columns remain nullable during expand.

Import and admin mutation batches are actor-bound, TTL 30 minutes, and follow
`PREVIEWED -> COMMITTED | CANCELLED | EXPIRED`. Commit/cancel purges staged
PII immediately; expiry first denies reads/commit and an idempotent cleanup
command performs physical purge. Every referenced user (target, dependency,
email owner, coverage teacher, rotation candidate) has a user-link row so a
hard delete can cancel and purge the batch.

## Lock and receipt contract

All writers use the global order in plan §6.8: mutation state, sorted identity
advisory locks, batch rows, sorted user rows, years, classes, enrollments and
transitions, teacher profiles/access, then grants/audit/receipts. Serializable
retry is bounded to three attempts and returns a stable conflict rather than an
unhandled 500. `AdminOperationReceipt` is namespaced by actor, operation kind,
and operation ID; same fingerprint retries the authoritative summary, while a
different fingerprint returns 409.
