# Learning Stream v2 Internal Soak and Incident Runbook

> 狀態：internal／test only；未批准 production rollout
> 日期：2026-08-12
> 目的：為 V2 internal validation 提供可重跑的觀察、pause、rollback 及 support procedure

## 1. Scope

This runbook applies only to explicitly allowlisted internal/test accounts. Product V1 remains
the default, research assignment remains disabled, and no real student or research data is used
by the internal soak. It is not approval for a student pilot, production deployment, or contract
migration.

## 2. Assignment and kill switch

- Assignment source: `STUDY_V2_INTERNAL_USER_IDS`, parsed as a bounded comma-separated allowlist.
- Default: empty value, which returns V1 for every account.
- Session rule: once a V2 session is issued, its `flowVersion` is pinned; disabling assignment
  stops new V2 sessions but does not rewrite an existing V2 outbox row into V1.
- Emergency action: remove all IDs from `STUDY_V2_INTERNAL_USER_IDS`, deploy the approved
  receipt-aware V1-default build, and keep all expand tables/columns in place.
- Never use this variable for research exposure, student cohort assignment, or a production
  percentage rollout without a separate approved plan and audit record.

## 3. Repeatable checks

Run from the repository root with local PostgreSQL available:

```bash
npm run check:study-credential-v2
node scripts/check-study-lineage-compatibility.mjs
npm run check:study-stream-v2:soak
npm run test:db
npm run test:e2e:card-motion
```

`check:study-stream-v2:soak` runs the cleanup-backed V2 integration fixture three times by
default. It asserts server scoring, global receipt idempotency, CAS/concurrency, admission cap,
credential renewal/lineage, unit/global scope, projections and cleanup on every iteration.

The 2026-08-12 local result was 3/3 passed, p50 917 ms, p95 1,059 ms, maximum 1,059 ms. This is
a synthetic local baseline, not a student-facing SLO.

## 4. Operational metric contract

V2 routes emit an allowlisted structured log record:

```json
{
  "metric": "study_stream_request",
  "metricVersion": 1,
  "route": "bootstrap | action | credential-renewal",
  "flowVersion": "v1 | v2",
  "status": 200,
  "outcome": "success | duplicate-replay | assignment-off | client-rejected | auth-rejected | not-found | conflict | rate-limited | unavailable | server-error",
  "durationMs": 123,
  "actionKind": "OBJECTIVE_ANSWER"
}
```

The record deliberately excludes user IDs, IPs, word IDs, operation IDs, credentials, answer
keys and exception messages. Until a production metrics backend is approved, the record is
extracted from the hosting platform's structured logs. The minimum dashboard/alert series are:

- action success, duplicate replay, conflict, rate-limited, auth/credential rejection and 5xx;
- oldest outbox age and sync-blocked count from client health instrumentation when approved;
- scheduler no-candidate, debt-cap hit, oldest obligation age and consecutive-probe cap;
- next-item p50/p95 and client render/abandonment points;
- aggregate objective recognition first-response accuracy and remediation rate.

No individual learner ranking, punishment or research inference is derived from these health
metrics.

## 5. Pause and rollback procedure

Pause V2 assignment immediately if any of these hard integrity conditions is observed:

1. receipt gap, incomplete V2 provenance, unresolved credential lineage gap or duplicate scored
   result;
2. a V2 action accepts a client-controlled word, kind, score or answer key;
3. an outbox row is silently deleted, converted to V1, or loses its operation/credential
   provenance;
4. auth/token-version revocation or session retirement fails closed;
5. a high/critical security, data-loss or accessibility defect is confirmed.

For latency, conflict, sync and abandonment, use the V1 baseline plus the internal soak baseline
to set pilot thresholds before any pilot approval. Do not invent fixed percentage thresholds in
an incident; record the baseline, sample window, numerator/denominator and owner decision in the
pilot plan first.

Rollback steps:

1. empty `STUDY_V2_INTERNAL_USER_IDS` and verify `/api/study/stream?assignmentOnly=1` returns
   `assigned: false` for a non-allowlisted account;
2. preserve expand schema and all committed V2 ledger rows;
3. let safe V2 sessions finish or retire/revoke them according to incident severity;
4. keep pending V2 actions visible and retryable; never translate them into V1 word payloads;
5. run V1 login/study/checkpoint/dashboard/unit/teacher/admin regression and the receipt inventory;
6. capture the incident, affected metric buckets and follow-up contract/cleanup decision.

## 6. Accessibility and support smoke

The local browser semantic check on 2026-08-12 verified:

- skip link, student navigation and `離開學習` link are exposed by accessible name;
- Learning Card exposes a labelled keyboard group with ArrowLeft/ArrowRight semantics and a
  reveal gate;
- Objective Probe exposes a labelled `radiogroup` with four native radios and checked/disabled
  state;
- feedback is exposed in an `aria-live="polite"` region and the acknowledgement action is
  available as a named button;
- reduced-motion, mouse, emulated touch and synthetic pointer suites remain covered by the
  existing E2E matrix.

This is semantic browser evidence only. Native screen-reader testing and physical-device mobile
acceptance remain required external gates.

Support response for a blocked sync: tell the learner that the pending operation was retained,
ask them to restore network/storage permission and press `重試`, and do not ask them to repeat a
probe until the authoritative feedback or a safe reload is shown. Escalate any missing/duplicate
operation with the timestamp and route/outcome metric only; never request or copy the credential.

## 7. External approvals still required

- production secrets, deploy and database migration window;
- V1 baseline and threshold approval for a student pilot;
- real student pilot plus parent/guardian permission and student assent;
- research governance, consent, retention and research telemetry approval;
- destructive legacy contract migration confirmation.
