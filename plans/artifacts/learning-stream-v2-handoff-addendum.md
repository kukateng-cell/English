# Learning Stream v2 Handoff Addendum

> 類型：Phase 0 versioned handoff addendum
> 狀態：已建立；供 Contract gate 及 dependent implementation 使用
> 日期：2026-08-12
> 所屬計劃：[learning-stream-v2-implementation.md](../learning-stream-v2-implementation.md)

## 1. Reproducible source

- Repository branch: `codex/retrieval-first-learning-stream-v2`
- Repository baseline: `cc7fd19` (`docs(plans): add retrieval-first learning program`)
- Working tree at capture: clean
- Design handoff archive: `/Users/hangwong/Documents/Design/emm_style_02`
- Design archive has no Git repository/commit; the file hashes below are the reproducible source
  identity for this handoff.
- Capture date and timezone: 2026-08-12, `Asia/Shanghai`

### Design source hashes (SHA-256)

| Source | SHA-256 |
|---|---|
| `DESIGN-HANDOFF.md` | `3e7a372c55ffcb84128f5b464e9a62580eab4de8b64015981365e88a4c69bb28` |
| `DESIGN-MANIFEST.json` | `37518b4860b1729e4ad243a4940211b41fb125a03e7fbccc83fba4150e491f65` |
| `assets/see-word.css` | `d434c6c392b2b2b04dc258c82df5142f53a5ba09640ef68fb2be83f82cb6787f` |
| `assets/see-word.js` | `d7e85c54c64fb137e35520085ef88a96dc8a79a1f328b3c7b7f3847e600d13c6` |
| `assets/theme.js` | `5d68893e8a2893489c0b9312bd4421dcf9b2c3360ba70f0f27950c2a97744918` |
| `brand-spec.md` | `173ce1331f982356f4f014b8708f39a01c9d76697f32b55b1924fa6595232f3c` |
| `home.html` | `d5abdfcafcc8e6c45d10f2854e11b52dec2b14b3bce090739c7de01e972df` |
| `index.html` | `b0bddcf8bdbb148995f4e35e66428cfb0491f637e89f0d135746aaef96b14924` |
| `learn.html` | `0ab80e86abe9c00278658322df08a553e1f15983bc8420673bbdf803ee2ac129` |
| `learn-v2.html` | `b97b7462ff127988c13c0c3a3ffc06c4925235f0c9e0cc63e4cb6c7454da8285` |
| `login.html` | `7ccc07c6031a13a1dc85c5fa71556b226262cfb7351bb52ba15629d911e73df9` |
| `stats.html` | `e00ad8c4951cde9044bd2096530acbfd60412e6c7a6003ad369ff85793feaed6` |
| `words.html` | `3c849e71a29753c6d2edc8a98d79bf94474fad4c75ee0065415a6b5bf6b193cd` |

The three PNG screenshot hashes are retained in the capture command output and are not used as
the interaction contract. The manifest remains the source for the responsive viewport matrix and
screen inventory.

## 2. Precedence

When sources disagree, use this order:

1. authentication, authorization, one-time credential, idempotency, server scoring, migration and
   rollback safety;
2. approved `retrieval-first-learning-contract.md`;
3. this addendum's explicit production deviations;
4. exported design handoff pixels, tokens and motion;
5. prototype-only demo state or timing.

The addendum narrows the design handoff only for Learning Stream behavior. It does not change the
brand, typography, spacing, responsive viewport matrix, motion primitives, accessibility intent or
the existing WordCard visual language.

## 3. State inventory and production manifest

### Learning Card

```text
PROMPT → REVEALED → SUBMITTING → ACKNOWLEDGED → NEXT
                         └──────→ RETRYABLE_SYNC_BLOCKED
```

- Before reveal, left/right input is inert and cannot dismiss the item.
- After reveal, left always means `selfForgot` and right always means `selfRecalled`.
- Self-rating is an operational encounter only; it never directly writes scored quality.
- The server response is authoritative for whether an Evidence Obligation was admitted.

### Objective Probe

```text
PROMPT → SUBMITTING → FEEDBACK → NEXT
             └──────→ RETRYABLE_SYNC_BLOCKED
```

- Options and order come from an immutable server snapshot; the client receives opaque option IDs
  and display text but not `correctOptionId`.
- The first accepted response is the only scored response. A retry replays the authoritative result.
- Feedback is read-only after scoring. Leaving before acknowledgement resumes that feedback once;
  it never reopens answer selection.

### Cross-cutting states

- `SYNC_BLOCKED` retains the exact operation and credential provenance, exposes retry/leave, and
  never advances the server cursor until acknowledgement.
- Checkpoint v1 remains decoded by the legacy decoder. V2 checkpoint data contains only an opaque
  stream-item pointer, server revision and minimal presentation state.
- `flowVersion` is pinned when a session is created and never changes mid-session.
- Research-only items and research ingestion are disabled in all product assignments in this phase.

## 4. Intentional production deviations from prototype

| Prototype behavior | Production interpretation |
|---|---|
| `learn-v2.html` shows `1 / 13` and a progress bar | Global `/study` is continuous and shows descriptive acknowledged counts only; no fixed denominator or completion pressure. |
| `learn-v2.html` has a fixed completion view | No mandatory completion page in Global mode. Unit mode may show a bounded summary after a safe stop. |
| Prototype inserts a quick check on a demo cadence | The server scheduler decides when a direct due probe, obligation or remediation item is eligible; no every-N-card rule. |
| Prototype/demo JavaScript computes choices and correctness locally | V2 snapshots, opaque option IDs and server-side scoring are authoritative. |
| Prototype's tap/swipe transitions can advance presentation immediately | Optimistic motion may run, but durable acknowledgement controls permanent item advancement and retry. |
| Prototype uses illustrative static words and metrics | Production renders authenticated server data and version bundles; no demo denominator or mastery claim is copied. |

`learn.html` is the closer visual reference for the continuous stream because it already says
“可隨時離開” and separates recognition cards from the quick-check presentation. Its static quiz
construction, however, remains prototype-only and is replaced by the V2 server contract.

## 5. Phase 0 baseline evidence

All commands were run from the repository baseline before runtime changes:

| Command | Result |
|---|---|
| `npm test` | 97 passed, 0 failed |
| `npm run lint` | passed |
| `npx tsc --noEmit` | passed |
| `npm run test:e2e:card-motion` | production build passed; primary browser run 73 passed / 4 skipped; WebKit shards 33 passed |

The first sandboxed E2E attempt failed while Turbopack tried to create a process/bind a port
(`Operation not permitted`). The same command was rerun with the repository-approved escalated
test permission and passed. This is an environment fact, not a product failure.

## 6. Phase 0 decisions carried into implementation

- Use new versioned boundaries: `GET /api/study/stream`, `POST /api/study/actions`, and
  `POST /api/study/sessions/renew`; retain `/api/study` unchanged for V1 compatibility.
- V2 outbox rows may durably retain the short-lived opaque item credential required for retry;
  the server stores only a digest. The row never contains a correct answer, quality or secret.
- V2 uses a separate `StudyStreamItem` identity, so the legacy `[sessionId, wordId]` unique key is
  untouched during product release.
- Exact snapshot retention/deletion days remain a production data-retention gate; no destructive
  cleanup or contract migration is authorized by this addendum.
