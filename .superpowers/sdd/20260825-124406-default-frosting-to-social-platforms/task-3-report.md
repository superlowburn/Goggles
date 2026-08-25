# Task 3 report: contextual controls, Settings, and popup

## Status

Implemented and committed. Trusted non-social pages expose an eligible-media **Always frost images here** action; protected pages add **Always show images here** after individual reveal while retaining **Frost again** and independent Blocked Subject protection. Settings now includes all eight social-platform switches and a removable protected non-social origin list. Popup requests continue through the reviewed platform-family/exact-origin worker routing with optimistic rollback.

## Files changed

- `src/content/content-controller.ts`
- `src/protection/renderer.ts`
- `src/protection/styles.ts`
- `src/options/options.html`
- `src/options/options.ts`
- `src/options/options.css`
- `tests/unit/content-controller.test.ts`
- `tests/unit/renderer.test.ts`
- `tests/unit/options.test.ts`
- `tests/unit/popup.test.ts`

The existing Blocked Subjects markup, parsing, storage, names, and editor logic were not rewritten.

## Red commands and expected failures

- `npm run test:unit -- tests/unit/renderer.test.ts` — 6 expected failures: trusted-page action layer, hover/focus control, isolated save action, failure/retry state, post-reveal site action, and contextual-control deduplication were absent.
- `npm run test:unit -- tests/unit/content-controller.test.ts` — 3 expected failures: trusted non-social control records, protected-page show persistence, and ordinary-media reconciliation with revealed-subject retention were absent.
- `npm run test:unit -- tests/unit/options.test.ts tests/unit/popup.test.ts tests/unit/service-worker.test.ts` — 6 expected Settings failures: sections, eight switches, independent persistence/rollback, protected-origin ordering, removal, and failed-removal rollback were absent; popup/worker routing and rollback coverage passed.
- `npm run test:unit -- tests/unit/renderer.test.ts tests/unit/content-controller.test.ts` — 2 expected integration-review failures: failed trusted-page actions did not remain visibly pinned and sub-threshold media still created a control root.
- `npm run test:unit -- tests/unit/options.test.ts -t "renders all eight social switches"` — 1 expected failure: the native checkbox controls lacked switch semantics.
- `npm run test:unit -- tests/unit/renderer.test.ts -t "responsive media crosses"` — 1 expected failure: a trusted-page action remained after responsive media shrank below `280x180`.

## Green commands and exact results

- `npm run test:unit -- tests/unit/renderer.test.ts` — 1 file passed, 36 tests passed after the first renderer cycle.
- `npm run test:unit -- tests/unit/content-controller.test.ts tests/unit/renderer.test.ts` — 2 files passed, 79 tests passed after controller reconciliation.
- `npm run test:unit -- tests/unit/options.test.ts tests/unit/popup.test.ts tests/unit/service-worker.test.ts` — 3 files passed, 30 tests passed; `npm run typecheck` exited 0.
- `npm run test:unit -- tests/unit/renderer.test.ts tests/unit/content-controller.test.ts tests/unit/options.test.ts tests/unit/popup.test.ts tests/unit/service-worker.test.ts` — 5 files passed, 111 tests passed; `npm run typecheck` exited 0.

## Full suite and build

- Fresh final `npm run typecheck` — exit 0.
- Fresh final `npm run test:unit` — 19 files passed, 227 tests passed.
- Fresh final `npm run build` — exit 0.
- Fresh final `git diff --check` — exit 0.

## Commit

Implementation commit: `5a0338e4506329f2456918c1b3541bfda210a4bd`.

## Self-review

- One renderer root owns Frost again and the contextual action; trusted-page roots leave underlying media/link hit areas untouched except for the hovered/focused button.
- One shared `280x180` eligibility function gates controller creation and renderer updates, including shrink/regrow transitions.
- Site actions validate trusted activation, isolate link clicks, remain keyboard focusable, honor reduced motion, deduplicate, wait for writes, and retain exact inline failure copy for retry.
- Successful policy writes rely on the existing live watcher to reconcile all current/future ordinary media. Subject records reconcile separately, so other matches remain frosted and a manually revealed matching item remains revealed.
- Settings iterates the ordered shared platform catalog, defaults missing switches On, rolls failed writes back inline, and lists only valid protected non-social exact origins in deterministic order.
- Popup production code did not need duplication: its verified-origin message flows through the Task 1 worker routing, and existing plus added tests cover exact-origin/platform requests and optimistic rollback.

## Concerns

- Repository-required six-site live visual QA is intentionally left for Task 4's integrated delivery gate. This task did not claim Reddit, CNN, NYT, Fox News, Washington Post, or WSJ passed.
- The isolated base does not contain the user's uncommitted subject/name-suggestion refinements; the Blocked Subjects section was left structurally untouched so integration can retain them.

## Round 1 review fixes

### Status

Implemented and committed as `22c2178a78ab9c8894d4d7b5313bc5ce7aff2490`.

### Red commands and expected failures

- `npm run test:unit -- tests/unit/content-controller.test.ts -t "falls back|fallback contextual"` — 3 expected failures: both failure fallbacks skipped policy watching, and a saved fallback action left the active media record trusted instead of reconciling to protected.
- `npm run test:unit -- tests/unit/renderer.test.ts -t "revealed item crosses"` — 1 expected failure: a revealed item's Always show action remained after shrinking below `280x180`.
- `npm run test:unit -- tests/unit/content-controller.test.ts -t "stale Always show"` — 1 expected failure: a retained revealed subject recreated stale Always show after Frost again and a second reveal on the now-trusted site.
- `npm run test:unit -- tests/unit/options.test.ts -t "waits for legacy social migration"` — 1 expected failure: Settings rendered Reddit On from a legacy snapshot instead of awaiting migration to the trusted platform-family rule.

### Green commands and exact results

- `npm run test:unit -- tests/unit/content-controller.test.ts -t "falls back|fallback contextual"` — 1 file passed, 4 tests passed, 41 skipped.
- `npm run test:unit -- tests/unit/renderer.test.ts -t "revealed item crosses"` — 1 file passed, 1 test passed, 37 skipped.
- `npm run test:unit -- tests/unit/content-controller.test.ts -t "stale Always show"` — 1 file passed, 1 test passed, 45 skipped.
- `npm run test:unit -- tests/unit/options.test.ts -t "waits for legacy social migration"` — 1 file passed, 1 test passed, 9 skipped; `npm run typecheck` exited 0.
- `npm run test:unit -- tests/unit/content-controller.test.ts tests/unit/renderer.test.ts tests/unit/options.test.ts tests/unit/popup.test.ts tests/unit/service-worker.test.ts tests/unit/video-visual-only.test.ts` — 6 files passed, 118 tests passed.
- Fresh final `npm run typecheck` — exit 0.
- Fresh final `npm run test:unit` — 19 files passed, 231 tests passed.
- Fresh final `npm run build` — exit 0.
- Fresh final `git diff --check` — exit 0.

### Self-review

- Fallback bootstrap registers and disposes the same live policy watcher as the normal path, so a successful contextual write updates current and future media without reload.
- One renderer synchronization path now adds/removes revealed actions on every layout update and clears saved actions so resize cannot resurrect them.
- Retained revealed subject records refresh their current policy and site action without replacing or re-frosting the item; subsequent refrost/reveal uses trusted-site controls.
- Settings waits for the shared serialized migration before taking its all-storage snapshot, rendering switches, or accepting writes.

### Concerns

- Delivery-level six-site visual QA remains assigned to Task 4; no live-site pass is claimed here.
