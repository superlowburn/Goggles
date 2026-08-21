# Subject-first Goggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make blocked subjects a first-class protection that always survives site-wide permission while reducing Goggles to one live site switch and two settings sections.

**Architecture:** Keep the existing independent `SitePolicyStore` and `BlockedSubjectsStore`. Reconcile existing `ContentController` records in place when either policy changes so ordinary layers can be removed without exposing or duplicating blocked matches. Present the same hierarchy through a single popup switch and subject-first settings.

**Tech Stack:** TypeScript, Chrome Manifest V3, Vitest/jsdom, Playwright Chromium

**Spec:** `docs/superpowers/specs/2026-08-21-subject-first-goggles-design.md`

## Global Constraints

- Blocked subjects always remain frosted, including on sites where general frosting is off.
- A deliberate per-item reveal remains allowed.
- Site and subject changes apply to open pages without refresh.
- Do not add dependencies, face recognition, pixel analysis, or a new policy store.
- Preserve linked-media click isolation, one-click video reveal, and one overlay per target.
- Keep internal trusted/protected values as implementation details; never show them to users.
- Existing Strict values migrate to protected behavior and Strict is not a selectable feature.

---

### Task 1: Live subject-first policy reconciliation

**Files:**
- Modify: `src/content/content-controller.ts`
- Modify: `src/shared/blocked-subjects.ts`
- Test: `tests/unit/content-controller.test.ts`
- Test: `tests/unit/blocked-subjects.test.ts`

**Interfaces:**
- Consumes: `candidateMatchesBlockedSubject(candidate, config): boolean`, `ContentController.applyMode(mode)`, and `ContentController.applyBlockedSubjects(config)`.
- Produces: live reconciliation where effective protection is `mode !== "trusted" || matchesBlockedSubject` and each target has at most one record.

- [ ] **Step 1: Write failing reconciliation tests**

Add unit cases that start with one matching and one ordinary candidate, then assert:

```ts
harness.controller.start({ origin: "https://news.example", mode: "protected", blockedSubjects });
harness.controller.applyMode("trusted");
expect(harness.renderer.activeFor(blockedImage)).toHaveLength(1);
expect(harness.renderer.activeFor(ordinaryImage)).toHaveLength(0);
```

Add the reverse transition, subject enable/disable, dynamic matching media, and repeated-change assertions proving no duplicate handles.

- [ ] **Step 2: Run the focused tests and confirm the current clear-then-scan behavior fails**

Run: `npx vitest run tests/unit/content-controller.test.ts tests/unit/blocked-subjects.test.ts`

Expected: at least the live transition or duplicate-count assertion fails.

- [ ] **Step 3: Implement minimal in-place reconciliation**

Add one focused controller helper that evaluates each connected candidate under the new combined policy, removes only records that no longer need protection, keeps matching records, creates missing records, then scans for new DOM candidates. Extend subject context matching to supported visual candidates using existing text sources; do not inspect pixels or video frames.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/unit/content-controller.test.ts tests/unit/blocked-subjects.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the policy slice**

```bash
git add src/content/content-controller.ts src/shared/blocked-subjects.ts tests/unit/content-controller.test.ts tests/unit/blocked-subjects.test.ts
git commit -m "fix: preserve blocked subjects across site changes"
```

### Task 2: One-switch popup and subject-first settings

**Files:**
- Modify: `src/popup/popup.ts`
- Modify: `src/popup/popup.css`
- Modify: `src/options/options.html`
- Modify: `src/options/options.css`
- Modify: `src/options/options.ts`
- Test: `tests/unit/popup.test.ts`
- Test: `tests/unit/options.test.ts`

**Interfaces:**
- Consumes: existing `policy:get-tab`, `policy:set-tab`, blocked-subject storage, and site-policy storage.
- Produces: one popup `role="switch"` that maps checked to `protected` and unchecked to `trusted`; settings ordered as Blocked subjects then Sites showing ordinary media.

- [ ] **Step 1: Write failing popup and settings tests**

Assert one switch with hostname-specific copy:

```ts
expect(root.querySelectorAll('[role="switch"]')).toHaveLength(1);
expect(root.textContent).toContain("Frost ordinary media on verified.example");
expect(root.textContent).toContain("Blocked subjects stay frosted");
```

Assert settings contains no default section, begins with Blocked subjects, and labels exceptions as Sites showing ordinary media.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run tests/unit/popup.test.ts tests/unit/options.test.ts`

Expected: FAIL on the existing mode-button structure and settings order.

- [ ] **Step 3: Implement the popup switch**

Use one native button with `role="switch"` and `aria-checked`. Checked sends `protected`; unchecked sends `trusted`. Keep optimistic state, verified-origin enforcement, rollback, error announcement, and `Open Goggles settings` behavior.

- [ ] **Step 4: Simplify settings**

Remove Default for new sites. Put Blocked subjects first. Rename Site rules to Sites showing ordinary media, render only trusted exceptions, use `Frost ordinary media again`, and explain that blocked subjects remain frosted.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/unit/popup.test.ts tests/unit/options.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the interface slice**

```bash
git add src/popup src/options tests/unit/popup.test.ts tests/unit/options.test.ts
git commit -m "feat: make subject protection first class"
```

### Task 3: Remove redundant on-media menus

**Files:**
- Modify: `src/protection/renderer.ts`
- Modify: `src/protection/styles.ts`
- Modify: `src/content/content-controller.ts`
- Test: `tests/unit/renderer.test.ts`
- Test: `tests/unit/content-controller.test.ts`
- Test: `tests/e2e/reddit-lightbox.regression-1.spec.ts`
- Test: `tests/e2e/stacked-images.spec.ts`

**Interfaces:**
- Consumes: `ProtectionRenderer.protect(candidate, options)` and the existing reveal surface/info control.
- Produces: whole-frost reveal, optional Show affordance, optional description control, optional Blocked subject reason, and at most one Frost again control after reveal.

- [ ] **Step 1: Write failing renderer expectations**

Assert protected ordinary media has no `.eg-goggles-control`, `.eg-menu`, `.eg-reveal-all`, or `.eg-allow-site`; blocked matches expose a textual reason through visible copy or the reveal surface accessible name.

- [ ] **Step 2: Run focused renderer tests and confirm failure**

Run: `npx vitest run tests/unit/renderer.test.ts tests/unit/content-controller.test.ts`

Expected: FAIL because the current renderer still constructs the goggles menu and allowed-site control.

- [ ] **Step 3: Remove redundant controls with the smallest renderer change**

Delete menu construction and site-level floating controls from rendered media. Preserve reveal-surface event isolation, info sizing thresholds, compact behavior, and the single anchored Frost again control. Pass a blocked-subject reason flag through protection options only if required for copy/semantics.

- [ ] **Step 4: Update Reddit regressions**

Assert one layer before reveal, zero protected layers after one click, unchanged URL for linked media, no duplicate controls for lightboxes or video/poster stacks.

- [ ] **Step 5: Run focused unit and browser tests**

Run: `npx vitest run tests/unit/renderer.test.ts tests/unit/content-controller.test.ts && npm run build && npx playwright test tests/e2e/reddit-lightbox.regression-1.spec.ts tests/e2e/stacked-images.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit the media-interface slice**

```bash
git add src/protection src/content/content-controller.ts tests/unit/renderer.test.ts tests/unit/content-controller.test.ts tests/e2e/reddit-lightbox.regression-1.spec.ts tests/e2e/stacked-images.spec.ts
git commit -m "refactor: simplify protected media controls"
```

### Task 4: Loaded-extension acceptance and visual/design review

**Files:**
- Modify: `tests/e2e/blocked-subjects.spec.ts`
- Modify: `tests/e2e/extension.spec.ts`
- Modify: `tests/e2e/settings-logo.spec.ts`
- Create screenshots under: `.gstack/qa-reports/screenshots/subject-first/`

**Interfaces:**
- Consumes: built `dist` extension and the popup/settings/content behaviors from Tasks 1-3.
- Produces: deterministic proof of live popup changes and inspected desktop/compact screenshots.

- [ ] **Step 1: Add the central loaded-extension regression**

On one fixture containing ordinary and matching media, toggle the actual popup off and on without reloading. Assert ordinary media changes immediately, the match retains exactly one layer, the page URL is unchanged, and subject settings apply live.

- [ ] **Step 2: Run the new test and fix only integration defects it exposes**

Run: `npm run build && npx playwright test tests/e2e/blocked-subjects.spec.ts`

Expected: PASS after any narrowly scoped integration fix.

- [ ] **Step 3: Run deterministic verification**

Run: `npm run verify`

Expected: TypeScript PASS, all unit tests PASS, build PASS, all non-live Playwright tests PASS with no retries.

- [ ] **Step 4: Capture and inspect product surfaces**

Capture popup on/off, settings desktop/mobile, ordinary protected media, allowed-site blocked match, linked Reddit thumbnail, Reddit lightbox, and Reddit video stack. Inspect each image for hierarchy, clipping, duplicate overlays, control alignment, wording, and contrast.

- [ ] **Step 5: Run fresh live visual QA**

Run the background live-site checks for Reddit, CNN, NYT, Fox News, Washington Post, and Wall Street Journal. Verify image and video frosting, one-click reveal, site-toggle behavior, and blocked-subject context. Record paywall, authentication, anti-bot, or unavailable-media blockers instead of claiming a pass.

- [ ] **Step 6: Perform the final design review**

Review popup, settings, protected media, and blocked-subject states at desktop and compact sizes. Fix P0/P1 issues, rerun affected tests, and write a short evidence-backed result.

- [ ] **Step 7: Commit acceptance coverage and final fixes**

```bash
git add tests/e2e src .gstack/qa-reports
git commit -m "test: verify subject-first goggles experience"
```
