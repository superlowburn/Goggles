# Goggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Chrome extension that universally frosts meaningful images and supported videos until the user intentionally reveals one media item.

**Architecture:** A Manifest V3 extension injects one content controller into every eligible frame at `document_start`. Pure modules classify media, resolve descriptions, render isolated frost overlays, gate native and embedded video, and observe dynamic DOM changes; a small service worker and popup coordinate origin-level policy through Chrome storage.

**Tech Stack:** Node.js 22+, TypeScript 7, esbuild 0.28, Vitest 4 with jsdom 30, Playwright 1.62, Chrome Manifest V3, DOM APIs, and `chrome.storage`.

**Spec:** `docs/superpowers/specs/2026-08-19-eclipse-goggles-design.md`

## Global Constraints

- Chrome Manifest V3 is the only browser target in the first release.
- Meaningful media receives exactly `backdrop-filter: blur(25px)` plus `rgba(211, 211, 211, 0.10)` and no saturation, hue, brightness, contrast, texture, or scaling changes.
- Revealing one item never reveals sibling media.
- Revealing a video never starts playback or unmutes it.
- Site modes are `trusted`, `protected`, and `strict`; `protected` is the default.
- Strict-mode media is protected again after being completely outside the viewport for two continuous seconds.
- Alt text and other page-provided descriptions are inserted only with `textContent`.
- No page text, URL, image, preference, or usage event leaves the device.
- The first release protects `img`, `picture` descendants, image inputs, eligible CSS backgrounds, native video, YouTube embeds, and Vimeo embeds.
- SVG, canvas, WebGL, closed shadow roots, other browsers, router rewriting, and the separate scratchpad idea are outside this plan.

## File map

```text
package.json                         Exact tool versions and test/build commands
tsconfig.json                        Strict TypeScript settings for DOM and Chrome APIs
vitest.config.ts                     jsdom unit-test configuration
scripts/build.mjs                    Bundles extension entries and copies static files
public/manifest.json                 Manifest V3 permissions and entry points
src/shared/media-types.ts            Media, policy, and message contracts
src/shared/site-policy.ts            Policy keys, validation, and storage adapter
src/background/service-worker.ts     Resolves top origin and services popup policy messages
src/media/classifier.ts              Pure meaningful-media classification
src/media/description.ts             Safe description precedence and fallback copy
src/media/provider-frames.ts         YouTube/Vimeo recognition and iframe source gating
src/media/native-video.ts            Native video pause/mute/release lifecycle
src/protection/styles.ts             Exact shadow-root frost and caption CSS
src/protection/renderer.ts           Overlay creation, positioning, reveal, and reprotect
src/protection/strict-guard.ts        Two-second out-of-viewport strict-mode timer
src/content/document-observer.ts     Batched initial, mutation, resize, and attribute discovery
src/content/content-controller.ts    Coordinates policy, media modules, and lifecycle
src/content/index.ts                 Content-script bootstrap and policy subscription
src/popup/popup.html                 Popup document
src/popup/popup.css                  Popup presentation and focus states
src/popup/popup.ts                   Current-site mode UI
tests/unit/setup.ts                  DOM and Chrome test cleanup
tests/unit/*.test.ts                 Pure and DOM integration tests by module
tests/e2e/fixtures/*                 Article, dynamic-feed, native-video, and iframe pages
tests/e2e/server.mjs                 Local fixture server
tests/e2e/extension.spec.ts          Loaded-extension acceptance tests
playwright.config.ts                 Persistent Chromium extension test configuration
README.md                            Local build, load, test, privacy, and limitations
```

---

### Task 1: Buildable Manifest V3 shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `scripts/build.mjs`
- Create: `public/manifest.json`
- Create: `src/background/service-worker.ts`
- Create: `src/content/index.ts`
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.ts`
- Create: `tests/unit/manifest.test.ts`
- Create: `tests/unit/setup.ts`

**Interfaces:**
- Produces: `dist/manifest.json`, `dist/service-worker.js`, `dist/content.js`, `dist/popup/popup.js`, `dist/popup/popup.html`, and `dist/popup/popup.css` from `npm run build`.
- Produces: the `src/background/service-worker.ts`, `src/content/index.ts`, and `src/popup/popup.ts` entry points used by later tasks.

- [ ] **Step 1: Write the failing manifest test**

```ts
// tests/unit/manifest.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));

  it("loads the content script at document_start in every frame", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts[0]).toMatchObject({
      matches: ["http://*/*", "https://*/*"],
      js: ["content.js"],
      run_at: "document_start",
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
    });
  });

  it("requests only the agreed permissions", () => {
    expect(manifest.permissions.sort()).toEqual(["activeTab", "storage"].sort());
    expect(manifest.host_permissions).toEqual(["http://*/*", "https://*/*"]);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-project failure**

Run: `npm test -- --run tests/unit/manifest.test.ts`

Expected: FAIL because `package.json` and `public/manifest.json` do not exist.

- [ ] **Step 3: Add the exact toolchain and TypeScript configuration**

```json
// package.json
{
  "name": "eclipse-goggles",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:unit": "vitest run",
    "test:e2e": "npm run build && playwright test",
    "verify": "npm run typecheck && npm run test:unit && npm run build && npm run test:e2e"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "@types/chrome": "0.2.6",
    "esbuild": "0.28.2",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests", "vitest.config.ts", "playwright.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["tests/unit/setup.ts"],
    restoreMocks: true,
  },
});
```

- [ ] **Step 4: Add the manifest, inert entry points, and popup shell**

```json
// public/manifest.json
{
  "manifest_version": 3,
  "name": "Goggles",
  "description": "Safety goggles for visual media on the web.",
  "version": "0.1.0",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "service-worker.js" },
  "action": { "default_popup": "popup/popup.html" },
  "content_scripts": [{
    "matches": ["http://*/*", "https://*/*"],
    "js": ["content.js"],
    "run_at": "document_start",
    "all_frames": true,
    "match_about_blank": true,
    "match_origin_as_fallback": true
  }]
}
```

Use `void 0;` as the initial content and background entry contents. The popup HTML must load `popup.js` with `<script type="module" src="popup.js"></script>` and contain `<main id="app">Goggles</main>`; its CSS must set a 280px minimum width and use system fonts.

- [ ] **Step 5: Add the deterministic esbuild script**

```js
// scripts/build.mjs
import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/popup", { recursive: true });

await Promise.all([
  ["src/background/service-worker.ts", "dist/service-worker.js"],
  ["src/content/index.ts", "dist/content.js"],
  ["src/popup/popup.ts", "dist/popup/popup.js"],
].map(([entryPoints, outfile]) => build({
  entryPoints: [entryPoints],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
})));

await Promise.all([
  cp("public/manifest.json", "dist/manifest.json"),
  cp("src/popup/popup.html", "dist/popup/popup.html"),
  cp("src/popup/popup.css", "dist/popup/popup.css"),
]);
```

- [ ] **Step 6: Install dependencies and verify the shell**

Run: `npm install`

Run: `npm run typecheck && npm run test:unit && npm run build`

Expected: all commands exit 0 and `dist/manifest.json` exists.

- [ ] **Step 7: Commit the buildable shell**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts scripts public src tests
git commit -m "chore: scaffold Goggles extension"
```

---

### Task 2: Origin policy and Chrome messaging

**Files:**
- Create: `src/shared/media-types.ts`
- Create: `src/shared/site-policy.ts`
- Replace: `src/background/service-worker.ts`
- Create: `tests/unit/site-policy.test.ts`
- Create: `tests/unit/service-worker.test.ts`
- Modify: `tests/unit/setup.ts`

**Interfaces:**
- Produces: `type SiteMode = "trusted" | "protected" | "strict"`.
- Produces: `policyKey(origin: string): string`, `isSiteMode(value: unknown): value is SiteMode`, and class `SitePolicyStore` with `get(origin: string): Promise<SiteMode>`, `set(origin: string, mode: SiteMode): Promise<void>`, and `watch(origin: string, listener: (mode: SiteMode) => void): () => void`.
- Produces: `PolicyContext { origin: string; mode: SiteMode }`.
- Produces messages `policy:get-current`, `policy:get-tab`, and `policy:set-tab` defined as the `ExtensionMessage` union.

- [ ] **Step 1: Write policy-store tests**

```ts
// tests/unit/site-policy.test.ts
import { describe, expect, it, vi } from "vitest";
import { SitePolicyStore, policyKey } from "../../src/shared/site-policy";

describe("SitePolicyStore", () => {
  it("defaults unknown origins to protected", async () => {
    const area = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    const store = new SitePolicyStore(area);
    await expect(store.get("https://example.com")).resolves.toBe("protected");
  });

  it("stores one validated mode by origin", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area);
    await store.set("https://example.com", "strict");
    expect(area.set).toHaveBeenCalledWith({
      [policyKey("https://example.com")]: "strict",
    });
  });
});
```

- [ ] **Step 2: Run the policy test and verify it fails**

Run: `npm test -- --run tests/unit/site-policy.test.ts`

Expected: FAIL because `SitePolicyStore` does not exist.

- [ ] **Step 3: Implement shared contracts and the injectable store**

```ts
// src/shared/media-types.ts
export type SiteMode = "trusted" | "protected" | "strict";
export type MediaKind = "image" | "background-image" | "native-video" | "video-iframe";
export interface MediaCandidate { element: HTMLElement; kind: MediaKind }
export interface PolicyContext { origin: string; mode: SiteMode }

export type ExtensionMessage =
  | { type: "policy:get-current" }
  | { type: "policy:get-tab"; tabId: number }
  | { type: "policy:set-tab"; tabId: number; mode: SiteMode };
```

`SitePolicyStore` must accept the structural subset `{ get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }`, return `protected` for missing or invalid values, and subscribe through an injected `chrome.storage.onChanged`-compatible event.

- [ ] **Step 4: Write service-worker message tests**

The test must import an exported `handleExtensionMessage(message, sender, deps)` function and assert:

```ts
expect(await handleExtensionMessage(
  { type: "policy:get-current" },
  { tab: { id: 7, url: "https://news.example/story" } },
  deps,
)).toEqual({ origin: "https://news.example", mode: "protected" });
```

Also assert that `policy:set-tab` verifies the requested tab with `tabs.get`, writes its origin, and returns the resulting `PolicyContext`.

- [ ] **Step 5: Implement and register the message handler**

`handleExtensionMessage` must reject absent tab URLs and non-HTTP(S) URLs with `{ error: "unsupported-page" }`. The module-level listener calls the pure handler with `chrome.storage.local` and `chrome.tabs`, returns `true`, and resolves `sendResponse` from the handler promise.

- [ ] **Step 6: Run policy and worker tests**

Run: `npm test -- --run tests/unit/site-policy.test.ts tests/unit/service-worker.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit origin policy**

```bash
git add src/shared src/background tests/unit
git commit -m "feat: add origin-level protection policy"
```

---

### Task 3: Media classification and safe descriptions

**Files:**
- Create: `src/media/classifier.ts`
- Create: `src/media/description.ts`
- Create: `src/media/provider-frames.ts`
- Create: `tests/unit/classifier.test.ts`
- Create: `tests/unit/description.test.ts`

**Interfaces:**
- Consumes: `MediaCandidate` and `MediaKind` from `src/shared/media-types.ts`.
- Produces: `ClassificationEnvironment { box(element): Pick<DOMRect, "width" | "height">; style(element): CSSStyleDeclaration }`.
- Produces: `classifyElement(element: Element, env: ClassificationEnvironment): MediaCandidate | null`.
- Produces: `resolveDescription(candidate: MediaCandidate): string`.
- Produces: `isSupportedVideoFrame(element): element is HTMLIFrameElement`.

- [ ] **Step 1: Write classifier boundary tests**

Cover these exact cases:

```ts
expect(classifyElement(image(640, 360), env)).toMatchObject({ kind: "image" });
expect(classifyElement(image(32, 32), env)).toBeNull();
expect(classifyElement(image(80, 80, { alt: "Profile photo" }), env)).toMatchObject({ kind: "image" });
expect(classifyElement(video(640, 360), env)).toMatchObject({ kind: "native-video" });
expect(classifyElement(youtubeIframe(640, 360), env)).toMatchObject({ kind: "video-iframe" });
```

Add CSS-background tests proving that a 640x360 empty element is protected while a same-sized element containing visible text or a button is ignored.

Also assert that `input[type=image]` follows image thresholds and that the `img` descendant inside `picture` is classified once rather than protecting the `picture` wrapper separately.

- [ ] **Step 2: Run classifier tests and verify they fail**

Run: `npm test -- --run tests/unit/classifier.test.ts`

Expected: FAIL because `classifyElement` does not exist.

- [ ] **Step 3: Implement the classifier**

Use these rules in order:

1. Reject non-`HTMLElement` values and elements with zero width or height.
2. Recognize native `video` regardless of the image threshold when either dimension is at least 96px.
3. Recognize only exact-host YouTube and Vimeo embed URLs through `isSupportedVideoFrame` in `provider-frames.ts`; Task 5 adds gating behavior to that same module without changing this predicate.
4. Recognize `img` and `input[type=image]` at 48x48 or larger.
5. Ignore an empty-alt image smaller than 96x96.
6. Protect a semantic image with non-empty alt text at 48x48 or larger.
7. Protect a CSS background only at 96x96 or larger, only when `backgroundImage !== "none"`, `textContent.trim()` is empty, and it has no `button, a, input, select, textarea, [role=button], [tabindex]` descendant.

- [ ] **Step 4: Write description precedence and injection-safety tests**

Assert alt text wins over `aria-label`, `figcaption` is used when alt is missing, iframe `title` describes video, and fallback copy is exact. Include `<img alt='<img src=x onerror=alert(1)>'>` and assert the resolver returns the literal string without creating DOM.

- [ ] **Step 5: Implement the pure description resolver**

Use this precedence: useful `alt`, `aria-label`, closest `figure > figcaption`, element `title`, then kind-specific fallback. Trim and collapse whitespace, limit display copy to 500 Unicode code points, and never read `innerHTML`.

- [ ] **Step 6: Run media unit tests**

Run: `npm test -- --run tests/unit/classifier.test.ts tests/unit/description.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit classification**

```bash
git add src/media/classifier.ts src/media/description.ts tests/unit
git commit -m "feat: classify meaningful visual media"
```

---

### Task 4: Isolated frost renderer and strict reveal lifecycle

**Files:**
- Create: `src/protection/styles.ts`
- Create: `src/protection/renderer.ts`
- Create: `src/protection/strict-guard.ts`
- Create: `tests/unit/renderer.test.ts`
- Create: `tests/unit/strict-guard.test.ts`

**Interfaces:**
- Consumes: `MediaCandidate`, `SiteMode`, and resolved description.
- Produces: `ProtectionRenderer.protect(candidate, { description, mode, onReveal, onReprotect }): ProtectionHandle`.
- Produces: `ProtectionHandle { reveal(): void; reprotect(): void; remove(): void; update(): void; isRevealed(): boolean }`.
- Produces: `StrictRevealGuard.watch(element, reprotect): () => void`.

- [ ] **Step 1: Write renderer DOM tests**

Create a 640x360 image with a stubbed bounding rectangle, protect it, and assert:

```ts
expect(document.querySelector("[data-eclipse-goggles-root]")).not.toBeNull();
expect(handle.isRevealed()).toBe(false);
expect(renderer.debugLayerFor(image)?.textContent).toContain("A black audio component");
expect(renderer.debugLayerFor(image)?.querySelector("img")).toBeNull();
```

Dispatch Enter on the layer and assert `onReveal` runs once and only that handle becomes revealed. Dispatch an untrusted synthetic click and assert it does not reveal. Unit tests may call the exported trusted-event decision function directly because jsdom events are never browser-trusted.

After reveal, assert the `Protect again` control re-protects only that item. Change the target rectangle, dispatch scroll and resize, flush one animation frame, and assert the layer's fixed coordinates update exactly once.

- [ ] **Step 2: Run renderer tests and verify they fail**

Run: `npm test -- --run tests/unit/renderer.test.ts`

Expected: FAIL because `ProtectionRenderer` does not exist.

- [ ] **Step 3: Implement exact frost styles and the closed shadow-root renderer**

`styles.ts` must include these declarations verbatim:

```css
.eg-frost {
  backdrop-filter: blur(25px);
  background: rgba(211, 211, 211, 0.10);
}
.eg-caption {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 13px 15px;
  color: #26292c;
  background: rgba(250, 250, 250, 0.94);
  border-radius: 9px;
}
```

Attach one host to `document.documentElement`, mark only the host with `data-eclipse-goggles-root`, and use `attachShadow({ mode: "closed" })`. Keep the host fixed to the viewport and synchronize layer rectangles from `getBoundingClientRect()` on a single requestAnimationFrame queue. Insert description text with `textContent`. Use a real `<button>` labeled `Reveal`; the full layer handles Enter, Space, and trusted pointer activation.

When revealed, retain only a small `Protect again` button that becomes visible when the original media is hovered or the button receives focus. Activating it calls `onReprotect` for that item only. For protected boxes smaller than 160x90, visually collapse the description into a `Reveal image` or `Reveal video` button while keeping the full description in its accessible label. Add `:focus-visible` styling and remove all transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Write strict guard fake-timer tests**

Use an injected `IntersectionObserver` factory. Assert that a revealed element remaining visible is not reprotected, leaving the viewport for 1999ms is not reprotected, reaching 2000ms calls `reprotect` once, and re-entry cancels the timer.

- [ ] **Step 5: Implement `StrictRevealGuard` and connect it only for strict handles**

The guard starts its timer when `intersectionRatio === 0`, clears it on any positive intersection, and returns a disposer that disconnects observation and clears pending timeouts. Protected and Trusted modes never instantiate the guard.

- [ ] **Step 6: Run renderer and strict tests**

Run: `npm test -- --run tests/unit/renderer.test.ts tests/unit/strict-guard.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit protection rendering**

```bash
git add src/protection tests/unit/renderer.test.ts tests/unit/strict-guard.test.ts
git commit -m "feat: render accessible media frost"
```

---

### Task 5: Native and embedded video consent

**Files:**
- Create: `src/media/native-video.ts`
- Modify: `src/media/provider-frames.ts`
- Modify: `src/media/classifier.ts`
- Create: `tests/unit/native-video.test.ts`
- Create: `tests/unit/provider-frames.test.ts`
- Modify: `tests/unit/classifier.test.ts`

**Interfaces:**
- Produces: `NativeVideoController.secure(video)`, `.release(video)`, `.reprotect(video)`, and `.restore(video)`.
- Produces: `isSupportedVideoFrame(element): element is HTMLIFrameElement`.
- Produces: `ProviderFrameController.gate(frame)`, `.release(frame)`, `.regate(frame)`, and `.restore(frame)`.

- [ ] **Step 1: Write native-video lifecycle tests**

Stub `pause` and begin with `muted = false`. Assert `secure` calls pause and mutes, a later `play` event calls pause again, `release` stops enforcement but leaves the video muted, `reprotect` resumes enforcement, and `restore` returns the original muted value without calling play.

- [ ] **Step 2: Implement `NativeVideoController` with a WeakMap**

Store `{ originallyMuted, released, onPlay }` per video. `secure` is idempotent. The play listener pauses and mutes only while `released === false`. `release` changes only the flag. `restore` removes the listener and restores `originallyMuted`.

- [ ] **Step 3: Write provider recognition and gating tests**

Recognize only:

- `https://www.youtube.com/embed/<id>`
- `https://www.youtube-nocookie.com/embed/<id>`
- `https://player.vimeo.com/video/<id>`

Reject ordinary YouTube watch pages, maps, forms, empty sources, and lookalike hostnames. Assert `gate` preserves the original `src`, changes the live `src` to `about:blank`, and is idempotent. Assert `release` restores the exact original source and never calls player APIs. Assert `regate` blanks it again.

- [ ] **Step 4: Implement exact-host provider gating**

Parse URLs with `new URL(frame.src, document.baseURI)`, compare exact hostnames and pathname prefixes, and keep state in a WeakMap. If the iframe has already loaded before observation, changing to `about:blank` cancels it. Do not gate unrecognized iframes.

- [ ] **Step 5: Re-run classifier tests against the completed provider module**

Run: `npm test -- --run tests/unit/classifier.test.ts tests/unit/native-video.test.ts tests/unit/provider-frames.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit video consent**

```bash
git add src/media tests/unit
git commit -m "feat: gate native and embedded video"
```

---

### Task 6: Dynamic document controller

**Files:**
- Create: `src/content/document-observer.ts`
- Create: `src/content/content-controller.ts`
- Replace: `src/content/index.ts`
- Create: `tests/unit/document-observer.test.ts`
- Create: `tests/unit/content-controller.test.ts`

**Interfaces:**
- Consumes: policy, classifier, description, renderer, strict guard, and video controllers.
- Produces: `DocumentObserver.start(onCandidates: (elements: readonly Element[]) => void): void`, `.scan(root: ParentNode): void`, and `.stop(): void`.
- Produces: `ContentController.start(context: PolicyContext): void`, `.applyMode(mode: SiteMode): void`, and `.stop(): void`.

- [ ] **Step 1: Write batched observer tests**

Append ten images synchronously and assert the candidate callback runs once after one animation frame with ten deduplicated elements. Change `src`, `srcset`, `poster`, `style`, and `class` and assert those elements are reconsidered. Assert `stop()` disconnects mutation and resize observation.

- [ ] **Step 2: Implement batched discovery**

Observe `childList`, `subtree`, and the exact attribute filter `src,srcset,poster,style,class,alt,title,aria-label`. Add changed elements and their media descendants to a `Set<Element>`, then flush on one requestAnimationFrame. The initial scan uses one `TreeWalker` over all HTML elements so externally styled background images are considered without repeated selector passes. A `ResizeObserver` reconsiders previously undersized candidates and updates rectangles for protected elements.

- [ ] **Step 3: Write controller integration tests**

Inject fake dependencies and assert:

1. `trusted` starts no observer and clears protection.
2. `protected` classifies, resolves, and protects one candidate.
3. Revealing a native video calls `NativeVideoController.release` but not `play`.
4. Reprotecting strict native video calls `.reprotect`.
5. Revealing a provider frame calls `ProviderFrameController.release`.
6. Switching to Trusted removes layers, restores native state, and restores provider sources.
7. A rejected policy message starts Protected mode and does not persist anything.

- [ ] **Step 4: Implement the controller as the only orchestration layer**

Keep one WeakMap from element to its candidate and handle. On discovery, ignore already protected elements unless a relevant attribute changed. For native video call `secure` before rendering; for provider frames call `gate` before rendering. The renderer callbacks release or reprotect only the selected element. `applyMode` reconciles all existing handles immediately.

Process each candidate inside its own `try/catch`; one malformed page element must not stop the batch. In development builds, log only the element tag name and local error message, never its text, URL, alt value, or serialized markup.

- [ ] **Step 5: Bootstrap policy at document start**

`src/content/index.ts` must:

1. Return immediately on non-HTTP(S) documents unless it is a child `about:blank` frame created by a supported page. Also return inside a child frame whose own URL is a recognized YouTube or Vimeo player, because its parent-frame gate owns consent and loads it only after reveal.
2. Create the controller with production DOM dependencies.
3. Send `{ type: "policy:get-current" }`.
4. Start in `protected` mode if messaging fails.
5. Subscribe to the exact storage key for the returned top origin and call `applyMode` on changes.
6. Stop the controller on `pagehide`.

- [ ] **Step 6: Run all unit tests and typecheck**

Run: `npm run typecheck && npm run test:unit`

Expected: PASS.

- [ ] **Step 7: Commit dynamic protection**

```bash
git add src/content tests/unit
git commit -m "feat: protect dynamic page media"
```

---

### Task 7: Three-mode extension popup

**Files:**
- Replace: `src/popup/popup.html`
- Replace: `src/popup/popup.css`
- Replace: `src/popup/popup.ts`
- Create: `tests/unit/popup.test.ts`

**Interfaces:**
- Consumes: `SiteMode`, `PolicyContext`, and `ExtensionMessage`.
- Produces: `mountPopup(root, chromeApi): Promise<void>` for deterministic testing.

- [ ] **Step 1: Write popup behavior tests**

Assert the popup asks for the active tab, renders the verified hostname from the worker response, and renders exactly three radio-like buttons:

- `Trusted` / `Show normally`
- `Protected` / `Frost individually`
- `Strict` / `Always re-protect`

Click Strict and assert `{ type: "policy:set-tab", tabId, mode: "strict" }` is sent. Resolve it and assert `aria-pressed="true"` moves to Strict. Reject it and assert the prior mode remains selected with a visible local error.

- [ ] **Step 2: Run the popup test and verify it fails**

Run: `npm test -- --run tests/unit/popup.test.ts`

Expected: FAIL because `mountPopup` does not exist.

- [ ] **Step 3: Implement accessible popup markup and behavior**

Use one `<h1>Goggles</h1>`, hostname text, a `<div role="group" aria-label="Image protection for this site">`, and three `<button type="button">` controls. Keep all copy in the popup module and all visual styling in `popup.css`. Use visible `:focus-visible` outlines and no animation when `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Build and verify popup tests**

Run: `npm run typecheck && npm test -- --run tests/unit/popup.test.ts && npm run build`

Expected: PASS and the built popup contains no inline script.

- [ ] **Step 5: Commit popup controls**

```bash
git add src/popup tests/unit/popup.test.ts
git commit -m "feat: add site protection controls"
```

---

### Task 8: Loaded-extension acceptance suite and handoff documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/server.mjs`
- Create: `tests/e2e/fixtures/article.html`
- Create: `tests/e2e/fixtures/dynamic-feed.html`
- Create: `tests/e2e/fixtures/video.html`
- Create: `tests/e2e/fixtures/frame-host.html`
- Create: `tests/e2e/extension.spec.ts`
- Create: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the complete `dist` extension.
- Produces: `npm run verify` as the release-readiness command.

- [ ] **Step 1: Add the local fixture server and Playwright configuration**

The server must bind `127.0.0.1:4173`, serve only files under `tests/e2e/fixtures`, map `/` to `article.html`, and reject `..` path traversal with HTTP 400. Configure Playwright with one Chromium project, one worker, trace-on-first-retry, and `webServer.command = "node tests/e2e/server.mjs"`.

Launch a persistent context in the test with:

```ts
const context = await chromium.launchPersistentContext("", {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
```

- [ ] **Step 2: Write the failing image acceptance test**

The article fixture must contain a 640x360 image with alt text, a 24x24 icon, and two sibling content images. Assert the content image gets a visible Goggles layer with the alt text, the icon does not, clicking one Reveal leaves its sibling protected, and pressing Enter can reveal the sibling.

Run: `npm run test:e2e -- --grep "protects article images"`

Expected: FAIL until test selectors are exposed through safe host attributes or Playwright locators.

- [ ] **Step 3: Expose non-sensitive testable state and pass image E2E**

The renderer host may expose only `data-eclipse-goggles-root` and each protected target may expose `data-eclipse-goggles-protected="image|video"`. It must never expose alt text, URLs, or storage keys as attributes. Use those attributes for Playwright assertions.

- [ ] **Step 4: Add dynamic and video acceptance tests**

Assert:

1. An image appended after 100ms becomes protected.
2. A native autoplay video is paused and muted.
3. Revealing that video leaves it paused and muted.
4. A YouTube-format iframe source becomes `about:blank` before reveal and is restored exactly after reveal.
5. A Vimeo-format iframe follows the same gate-and-restore lifecycle.
6. Strict mode re-protects a revealed image after it is scrolled fully away for at least two seconds.
7. Trusted mode removes every protection layer without reload.
8. Media inserted by a client-side route replacement is protected.
9. A native video in a nested same-origin frame is protected while a recognized provider child frame is not double-protected.
10. Overlay rectangles remain aligned within one CSS pixel after viewport resizing, 125% page zoom, and a Chromium context using `deviceScaleFactor: 2`.

- [ ] **Step 5: Add accessibility and privacy assertions**

Use Playwright keyboard navigation to reach a protected item and verify a visible focus indicator. Assert caption text contrast colors are the specified values. Intercept all page requests during the local fixtures and fail if the extension initiates any request whose destination is not the fixture server; the intentionally restored YouTube URL is tested with route fulfillment so no external request occurs.

- [ ] **Step 6: Write the operator README**

Document:

- `npm install`, `npm run build`, and `npm run verify`.
- Loading `/Users/USER/Projects/Fader/dist` through `chrome://extensions` in developer mode.
- Trusted, Protected, and Strict semantics.
- Image and video reveal behavior.
- Local-only privacy statement.
- First-release limitations from the spec.
- Why a normal router cannot reproduce the per-media consent UI over HTTPS.

- [ ] **Step 7: Run the complete release check**

Run: `npm run verify`

Expected: typecheck, unit tests, build, and loaded-extension Playwright tests all pass.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only Task 8 files are uncommitted.

- [ ] **Step 8: Commit the verified extension handoff**

```bash
git add .gitignore playwright.config.ts tests/e2e README.md
git commit -m "test: verify Goggles in Chromium"
```

---

## Final verification

- [ ] Run `npm run verify` from a clean checkout.
- [ ] Load `dist` into Chrome and manually verify one article page, one infinite-scroll page, one native video, one YouTube embed, and one Vimeo embed.
- [ ] Confirm Reveal never starts or unmutes video.
- [ ] Confirm an unrevealed video cannot enter fullscreen through its covered native controls and a revealed video can use its normal fullscreen control.
- [ ] Confirm the browser network panel shows no extension-owned outbound requests.
- [ ] Confirm `git status --short` is empty.
- [ ] Compare the implementation against every acceptance criterion in `docs/superpowers/specs/2026-08-19-eclipse-goggles-design.md` and record any browser-specific limitation in `README.md` before release.
