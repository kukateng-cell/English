# Phase 6 visual and accessibility QA

Date: 2026-08-12 (Asia/Shanghai)

## Reference comparison

Compared `login`, `home`, `learn`, `words`, and `stats` against the EMM Style 01
reference captures at `390x844`, `820x1180`, and `1440x900`. Final implementation
captures are the same-named PNGs in this directory. Light Traditional Chinese,
light Simplified Chinese, dark Traditional Chinese, keyboard focus, and authenticated
real-data states were also captured.

Intentional deviations and acceptance:

- Dashboard uses the real dynamic next-session aggregate (20 due / 5 new caps) and
  recorded Review data; it does not add a fixed daily-task schema or copy prototype
  sample values.
- Words uses real available levels, categories, unlocked-only visibility and shared
  status definitions. It is read-only and shows an explicit read-only contract in the
  Coach sheet; the prototype's fixed A2/category examples are not production data.
- Study remains immersive: StudentNav is hidden/inert during assess, quiz, Coach
  sheet, and guarded pending/blocked sync states. The existing study state machine and
  server contracts remain unchanged.
- Teacher and admin use the density-appropriate `WorkspaceShell`; the prototype is
  student-only, so no student motivational layout was imposed on those roles.
- Bottom navigation uses an opaque semantic surface so fixed navigation cannot let
  content bleed through while scrolling. The 320px admin level distribution becomes a
  2x2 grid; this is a responsive correction, not a product-policy change.
- The admin word library uses a 100-row client page with an explicit “load more” action;
  the student word API remains cursor-paginated. This keeps large lists operable without
  changing the read-only data contract.
- Fonts use system fallbacks instead of build-time remote Google font loading. This
  removes the baseline build/network blocker while retaining the documented type scale.

## Responsive evidence

All four authenticated student destinations (`/`, `/study`, `/words`, `/stats`) were
measured at `320x568`, `360x800`, `390x844`, `430x932`, `844x390`, `600x960`,
`820x1180`, `1024x768`, `1366x768`, `1440x900`, and `1920x1080`. For every route,
`document.documentElement.scrollWidth <= innerWidth`; no horizontal overflow was
masked with `overflow-x: hidden`. Shell pages report the expected 4px vertical
scrollbar difference between `innerWidth` and `clientWidth`.

Additional checks:

- safe-area padding: mobile StudentNav computed bottom padding `6px` in the browser
  environment, with `env(safe-area-inset-bottom)` fallback and student content bottom
  padding preserved;
- soft-keyboard safeguard: login input computed font size `16px`, focused input stayed
  reachable, `visualViewport` remained observable, and no horizontal overflow appeared;
- iOS dynamic viewport: `CSS.supports('height', '100svh') === true` and shell CSS uses
  `svh`/safe-area-aware sizing;
- WCAG text-spacing override (`letter-spacing: .12em`, `line-height: 1.5`) at
  `320x568`: `scrollWidth=316`, `clientWidth=316`; the 320 CSS-pixel viewport is the
  reflow equivalent used for the 400% zoom acceptance check (the automation does not
  fake browser zoom with CSS `zoom`).
- reduced-motion + Forced Colors emulation at `320x568`: both media queries matched,
  transition duration collapsed to `0.00001s`, and `scrollWidth=316`/`clientWidth=316`.

Teacher and admin workspace routes were also measured at `320x568`; every route had
no horizontal overrun. The admin dashboard's level cards were changed to a responsive
2-column mobile grid after the first visual pass found the B2 card clipped.

## Accessibility evidence

- axe WCAG 2A/2AA loaded-state smoke: zero violations on student `/`, `/words`,
  `/study`, `/stats` in both light and dark; zero on login in both themes; zero on
  teacher dashboard in both themes and loaded admin users/words surfaces after their
  data settled.
- Word Coach: keyboard activation opened `role=dialog`, Escape closed it, and focus
  returned to the original word row. The sheet exposes `aria-modal`, title relation,
  focus containment, and inert background behavior.
- Account menu: keyboard activation opened the menu, Escape closed it, and focus
  returned to the account button.
- Login keyboard-only smoke: Tab reached brand link, theme, both locale controls,
  labelled username/password inputs, and submit button in order.
- macOS VoiceOver smoke: VoiceOver was launched directly for the test, then closed.
  With it active, login focus reached the branded link, theme button, and locale button;
  the Words Coach dialog opened as a dialog and Escape returned focus to its originating
  word row. The automation records DOM focus and dialog state; it does not capture spoken
  audio.
- Global `MotionConfig reducedMotion="user"` plus existing WordCard reduced-motion
  handling covers Framer Motion and custom study motion.

## Evidence limits

The local default environment intentionally has no production Upstash, cron, or audit
hash secrets. The unmodified `npm run check:production-config` invocation therefore
rejects the incomplete local environment. The pure shape check was also run once with
ephemeral, non-production environment values and passed; no secret was written or
deployed. Production smoke/deployment was not run because the task explicitly forbids
deployment and external production mutation.

## Final command evidence

- `npm test`: 93 passed.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; 38 routes generated.
- `npm run test:db`: passed (`Review ledger/idempotency/concurrency check passed`).
- `npm run test:e2e:card-motion`: passed; Chromium 73 passed / 4 skipped, WebKit shards
  17 and 16 passed.
- `npm run test:e2e:student-ia`: 9 passed.
- `npm run test:e2e:workspace`: 2 passed.
- `npx prisma migrate status`: 19 migrations found, database up to date; no schema or
  migration files changed, so checksum/fresh-replay/contract regression was not applicable.
- `.github/workflows/deploy-production.yml` was inspected. No push, PR, deployment, or
  destructive database command was run.
