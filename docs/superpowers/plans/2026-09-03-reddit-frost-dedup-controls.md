# Reddit Frost Deduplication and Control Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Goggles place one frost layer on Reddit's visually duplicated hero media, reveal it with one click, and keep the site-level action visibly anchored beside the re-frost control on Reddit and YouTube.

**Architecture:** Fix candidate selection at the existing classifier boundary so the empty-alt backdrop is rejected before the controller or renderer creates a record. Keep the renderer structure intact and change only the existing site-action positioning CSS. Do not add a new deduplication service, page-specific content script, dependency, or control component.

**Tech Stack:** TypeScript, Manifest V3, Vitest, Playwright, native DOM geometry and attributes.

**Spec:** `/Users/steve/Projects/Fader/.gstack/qa-reports/qa-report-chrome-reddit-youtube-2026-09-03.md`

## Global Constraints

- Implement in `/Users/steve/Projects/worktrees/default-frosting-social-20260825-1248`, because that worktree contains the v0.2 source that produced the live Chrome DOM.
- Preserve the existing uncommitted `96x96` site-control threshold work in `src/protection/renderer.ts` and its tests.
- Goggles and Big Ugly Orange Face are separate products and repositories. This plan fixes Goggles' own duplicate layers; it does not modify or absorb Big Ugly Orange Face code.
- Validate Goggles with only its `dist` build enabled. If Big Ugly Orange Face remains enabled, one independent BUOF layer can still appear and is not removable from Goggles alone.
- Do not add dependencies or new production files.
- Before any push, rebuild `dist`, recreate `goggles-0.2.0.zip`, verify it with `unzip -t`, and confirm `manifest.json` is at the ZIP root.
- Before reporting a user-visible code change complete, run fresh screenshot QA on Reddit, CNN, The New York Times, Fox News, The Washington Post, and The Wall Street Journal, naming any login, paywall, or anti-bot blocker.

---

### Task 1: Reproduce Reddit's real nested hero markup

**Files:**
- Modify: `tests/e2e/fixtures/reddit-lightbox.html`
- Modify: `tests/e2e/reddit-lightbox.regression-1.spec.ts:9-42`
- Modify: `tests/unit/stacked-image-classification.test.ts:41-100`

**Interfaces:**
- Consumes: `classifyElement(element, env): MediaCandidate | null`
- Produces: a regression fixture where the empty-alt backdrop and meaningful foreground share a source and overlap, but are nested under different immediate parents outside `#shreddit-media-lightbox`

- [ ] **Step 1: Change the unit fixture to match the live nesting**

Wrap each image in a different nested container while keeping the same source and overlapping rectangles:

```ts
const card = document.createElement("article");
const backdropShell = document.createElement("div");
const foregroundShell = document.createElement("a");
const backdrop = document.createElement("img");
const foreground = document.createElement("img");
backdrop.src = "/reddit-hero.png";
foreground.src = "/reddit-hero.png";
foreground.alt = "r/canada article preview";
backdropShell.append(backdrop);
foregroundShell.append(foreground);
card.append(backdropShell, foregroundShell);
setRect(backdrop, rect(-72, 135, 864, 454));
setRect(foreground, rect(0, 173, 720, 378));
```

Assert that the backdrop returns `null` and the meaningful foreground remains an image candidate.

- [ ] **Step 2: Run the focused unit test and verify the regression fails**

Run:

```bash
npx vitest run tests/unit/stacked-image-classification.test.ts
```

Expected: the new nested-backdrop assertion fails because `hasMeaningfulOverlappingCopy` searches only the backdrop's immediate parent outside `#shreddit-media-lightbox`.

- [ ] **Step 3: Update the browser fixture to use the same nested card structure**

Remove the `#shreddit-media-lightbox` dependency from the fixture. Keep two same-source overlapping images, an empty `alt` backdrop, and a meaningful foreground under separate immediate parents.

- [ ] **Step 4: Tighten the E2E acceptance assertions**

Keep the existing one-protected-element and one-reveal-button assertions, then add:

```ts
await expect(page.locator("[data-eclipse-goggles-root] .eg-layer.eg-frost")).toHaveCount(1);
await page.getByRole("button", { name: /Reveal protected media/ }).click();
await expect(page.locator("[data-eclipse-goggles-root] .eg-frost")).toHaveCount(0);
await expect(page.getByRole("button", { name: "Frost again" })).toHaveCount(1);
await expect(page.getByRole("button", { name: "Always show images here" })).toHaveCount(1);
```

- [ ] **Step 5: Build and run the focused E2E test to verify it fails before the classifier fix**

Run:

```bash
npm run build
npx playwright test tests/e2e/reddit-lightbox.regression-1.spec.ts
```

Expected: FAIL because the nested empty-alt backdrop receives a second Goggles layer.

### Task 2: Deduplicate same-source overlapping images at classification

**Files:**
- Modify: `src/media/classifier.ts:68-91`
- Test: `tests/unit/stacked-image-classification.test.ts`
- Test: `tests/e2e/reddit-lightbox.regression-1.spec.ts`

**Interfaces:**
- Consumes: `ClassificationEnvironment.box(element)` and native `HTMLImageElement.currentSrc/src`
- Produces: `hasMeaningfulOverlappingCopy(element, env): boolean` that detects a meaningful same-source overlapping image anywhere in the same document, regardless of immediate-parent nesting

- [ ] **Step 1: Replace the parent/lightbox search with one bounded document query**

Use the existing source equality and overlap checks, but search described images in the owning document:

```ts
function hasMeaningfulOverlappingCopy(
  element: HTMLImageElement,
  env: ClassificationEnvironment,
): boolean {
  const box = env.box(element);
  const source = element.currentSrc || element.src;
  for (const candidate of element.ownerDocument.querySelectorAll("img[alt]")) {
    if (
      candidate === element ||
      !(candidate instanceof HTMLImageElement) ||
      !candidate.getAttribute("alt")?.trim() ||
      (candidate.currentSrc || candidate.src) !== source
    ) {
      continue;
    }
    if (substantiallyOverlaps(box, env.box(candidate), 0.5)) return true;
  }
  return false;
}
```

This keeps the existing safeguards: only the empty-alt copy is discarded, sources must match, boxes must be comparable in size, and at least 80% of the smaller image must overlap.

- [ ] **Step 2: Run focused unit tests**

Run:

```bash
npx vitest run tests/unit/stacked-image-classification.test.ts tests/unit/classifier.test.ts tests/unit/classifier.regression-1.test.ts
```

Expected: PASS, including non-overlapping and different-source controls.

- [ ] **Step 3: Build and run the focused Reddit E2E regression**

Run:

```bash
npm run build
npx playwright test tests/e2e/reddit-lightbox.regression-1.spec.ts tests/e2e/stacked-images.spec.ts
```

Expected: PASS with one Goggles frost layer, one reveal action, one `Frost again`, and one `Always show images here` action.

- [ ] **Step 4: Commit the classifier fix without staging unrelated dirty work**

Run:

```bash
git add src/media/classifier.ts tests/unit/stacked-image-classification.test.ts tests/e2e/fixtures/reddit-lightbox.html tests/e2e/reddit-lightbox.regression-1.spec.ts
git commit -m "fix: deduplicate nested Reddit hero images"
```

### Task 3: Anchor the site action beside the re-frost control

**Files:**
- Modify: `src/protection/styles.ts:188-225`
- Modify: `tests/unit/renderer.test.ts:182-203`
- Modify: `tests/e2e/extension.spec.ts` near the existing `Always show images here` assertion

**Interfaces:**
- Consumes: existing CSS variables `--eg-control-top`, `--eg-control-right`, `--eg-control-size`, and class `eg-revealed eg-has-site-action`
- Produces: one top-right control cluster with the text action immediately left of the circular `Frost again` button

- [ ] **Step 1: Add a failing geometry assertion**

After revealing a 640 x 360 image, read both control rectangles and assert the site action is left of the re-frost control and vertically aligned:

```ts
const actionBox = action.getBoundingClientRect();
const reprotectBox = layer.querySelector<HTMLElement>(".eg-reprotect")!.getBoundingClientRect();
expect(actionBox.right).toBeLessThanOrEqual(reprotectBox.left - 8);
expect(Math.abs(actionBox.top - reprotectBox.top)).toBeLessThanOrEqual(1);
```

- [ ] **Step 2: Run the renderer test and verify it fails**

Run:

```bash
npx vitest run tests/unit/renderer.test.ts
```

Expected: FAIL because `.eg-site-action` is centered at the bottom of the revealed media.

- [ ] **Step 3: Reposition the existing action with CSS only**

For revealed and passive site-candidate layers, replace the centered-bottom placement with top-right anchoring. In the revealed state, reserve the re-frost button width plus an 8px gap:

```css
.eg-site-action {
  left: auto;
  right: var(--eg-control-right, 12px);
  top: var(--eg-control-top, 12px);
  bottom: auto;
  transform: none;
}

.eg-revealed.eg-has-site-action .eg-site-action {
  right: calc(var(--eg-control-right, 12px) + var(--eg-control-size, 44px) + 8px);
}
```

Keep the existing label, focus styles, opacity rules, save behavior, failure behavior, and responsive eligibility threshold.

- [ ] **Step 4: Run renderer and accessibility-focused tests**

Run:

```bash
npx vitest run tests/unit/renderer.test.ts
npx playwright test tests/e2e/extension.spec.ts
```

Expected: PASS; the action remains keyboard reachable, has one accessible name, does not trigger the underlying link, and no longer floats at bottom-center.

- [ ] **Step 5: Commit only the control-placement files**

Run:

```bash
git add src/protection/styles.ts tests/e2e/extension.spec.ts
git add -p tests/unit/renderer.test.ts
git diff --cached --check
git diff --cached
git commit -m "fix: anchor revealed media controls"
```

Stage only the new geometry-test hunk from `tests/unit/renderer.test.ts`; leave the pre-existing `96x96` threshold hunks unstaged.

### Task 4: Verify the complete fix and package only if shipping

**Files:**
- Verify: `dist/**`
- Conditionally update before push: `goggles-0.2.0.zip`
- Evidence: `.gstack/qa-reports/screenshots/**`

**Interfaces:**
- Consumes: the classifier and CSS changes from Tasks 2 and 3
- Produces: test output, six-site screenshots, exact Reddit/YouTube evidence, and a valid release ZIP if a push is authorized

- [ ] **Step 1: Run the automated verification suite**

Run:

```bash
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
```

Expected: all commands pass with no new skipped deterministic test.

- [ ] **Step 2: Reload only the Goggles `dist` extension in the isolated QA browser**

Do not load Big Ugly Orange Face in this acceptance run. Reload the exact Reddit post and YouTube video after the extension reload.

- [ ] **Step 3: Verify Reddit and YouTube acceptance criteria**

On the Reddit post, record one `data-eclipse-goggles-protected` hero, one `.eg-frost`, one reveal button, one click to reveal, one `Frost again`, and one anchored `Always show images here`. Confirm the separate comment-area advertisement is independently sized and does not inherit the hero rectangle.

On `https://www.youtube.com/watch?v=XRTon6qgVws`, confirm one 720 x 405 player frost, one-click reveal, one anchored site action, one re-frost control, and no duplicate overlay after navigation or reload.

- [ ] **Step 4: Run the mandatory six-site visual QA gate**

Capture and inspect screenshots from Reddit, CNN, The New York Times, Fox News, The Washington Post, and The Wall Street Journal. Check protected images/videos, reveal and re-frost, reveal-all, site allow and re-frost, Strict mode, Blocked Subjects on allowed sites, reload/navigation, dynamic media, image/video/link isolation, duplicate overlays, and control placement. Name every login, paywall, or anti-bot blocker instead of claiming that site passed.

- [ ] **Step 5: Check the final diff without disturbing unrelated changes**

Run:

```bash
git diff --check
git status --short
git diff -- src/media/classifier.ts src/protection/styles.ts tests/unit/stacked-image-classification.test.ts tests/unit/renderer.test.ts tests/e2e/fixtures/reddit-lightbox.html tests/e2e/reddit-lightbox.regression-1.spec.ts tests/e2e/extension.spec.ts
```

Expected: only planned changes plus the pre-existing user-owned dirty files are present; no unrelated file is staged.

- [ ] **Step 6: If and only if a push is authorized, rebuild and verify the versioned ZIP**

Rebuild `dist`, create a fresh archive from its contents so `manifest.json` stays at the ZIP root, atomically replace the tracked package, then verify it:

```bash
npm run build
goggles_zip_tmp=$(mktemp /tmp/goggles-0.2.0.XXXXXX)
(cd dist && /usr/bin/zip -qr "$goggles_zip_tmp" . -x '*.DS_Store')
mv "$goggles_zip_tmp" goggles-0.2.0.zip
unzip -t goggles-0.2.0.zip
unzip -Z1 goggles-0.2.0.zip | grep -x manifest.json
```

Expected: archive integrity passes and exactly one root `manifest.json` is present. Include the rebuilt ZIP in the same push.

## Deliberate limitation

With both Goggles and Big Ugly Orange Face enabled, each product can still place its own single layer on subject-matched media. Eliminating that final cross-product overlap requires a separate, coordinated ownership protocol implemented and tested in both repositories. Do not smuggle that second project into this fix.
