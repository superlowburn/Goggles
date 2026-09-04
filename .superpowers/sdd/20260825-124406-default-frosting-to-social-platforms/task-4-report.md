# Task 4 report: integration, QA, and v0.2 packaging

## Status

Release implementation and package committed as `9d608d284e7a73f288760e8773bfaaf8e5edf03f`. Deterministic verification is green. Live visual QA passed on Reddit, CNN, The New York Times, and Fox News. The Washington Post and The Wall Street Journal were captured and recorded as blockers, not passes. No push was performed.

## Changed files

- Release documentation and metadata: `README.md`, `PRIVACY.md`, `package.json`, `package-lock.json`, `manifest.json`, `public/manifest.json`.
- Built release artifact: `goggles-0.2.0.zip`.
- Built-Settings integration fix: `src/background/service-worker.ts`, `tests/unit/service-worker.test.ts`.
- Release/package assertions: `tests/unit/release-artifacts.test.ts`.
- Truly headless deterministic and live QA: `tests/e2e/extension-storage.ts`, all loaded-extension specs under `tests/e2e`, and refreshed screenshots under `.gstack/qa-reports/screenshots/`.

## Red/green evidence

- Loopback fixture policy:
  - Red: `npx playwright test tests/e2e/extension.spec.ts -g 'protects article images' --reporter=line` — failed twice because `#first` correctly had no protection attribute under the new non-social default.
  - Green after explicitly seeding `site-policy:http://127.0.0.1:4173=protected`: the same test passed, and `lsappinfo front` was unchanged.
- Release metadata/package:
  - Red: `npm run test:unit -- tests/unit/release-artifacts.test.ts` — 2 expected failures: all metadata was `0.1.0` and `goggles-0.2.0.zip` did not exist.
  - Green after versioning/build/package: 2 tests passed.
- Built Settings sender:
  - Red: `npm run test:unit -- tests/unit/service-worker.test.ts -t 'returns effective social policies'` — the real packaged `/options/options.html` sender returned `invalid-message`.
  - Green after accepting only the two legitimate package/root Settings paths: 2 focused worker tests passed, 13 skipped; typecheck exited 0.
- Broader loaded-extension run exposed the same Settings boundary in both Blocked Subjects journeys; after the fix, the five focused loaded-extension checks passed headlessly with the foreground unchanged.

## Exact verification results

- Final `npm run typecheck` — exit 0.
- Final `npm run test:unit` — 20 files passed, 236 tests passed.
- `npm run test:e2e` — fresh build succeeded; 39 deterministic tests passed, 6 opt-in live tests skipped; foreground ASN unchanged before/after.
- Focused deterministic policy/video journeys — non-social default plus contextual exact-origin frost, contextual Always show, Reddit default plus platform Off and subjects, native playback identity/state, and provider source/autoplay all passed.
- Focused artifact tests — `tests/unit/manifest.test.ts`, `tests/unit/video-visual-only.test.ts`, and `tests/unit/release-artifacts.test.ts`: 3 files passed, 9 tests passed.
- Built-JavaScript forbidden-symbol scan — no video pause/mute/seek mutation, provider controller/messages, declarative request gate, `webNavigation`, or removed provider asset symbols found.
- Removed-asset checks — `src/media/native-video.ts`, `src/background/provider-request-gate.ts`, `public/provider-rules.json`, `public/provider-blocked.html`, and root `provider-blocked.html` absent.
- `git diff --check` — exit 0 before release commit.

## Per-site visual QA

All automation used `channel: "chromium"`, `headless: true`, a fresh temporary profile, and a 480x320 viewport. No address bar, headed browser, `open`, or AppleScript interaction was used. Each final per-site run recorded the same foreground ASN before and after.

- Reddit — passed. Ordinary media was protected by default; reveal/refrost, social Always show, reload/navigation, dynamic ordinary media, Blocked Subjects on platform Off, link isolation, duplicate layers/control placement, and visual-only native/provider video checks passed. Screenshots: `.gstack/qa-reports/screenshots/v0.2/reddit-default.png`, `reddit-frosted.png`.
- CNN — passed after accepting the cookie-consent dialog inside the isolated profile. Default ordinary media was visible; contextual Always frost, reveal/refrost, exact-origin Always show, reload/navigation, dynamic media, Blocked Subjects, isolation, and video checks passed. Screenshots: `cnn-default.png`, `cnn-frosted.png`.
- The New York Times — passed with the same news-site journey. Screenshots: `nyt-default.png`, `nyt-frosted.png`.
- Fox News — passed with the same news-site journey. Screenshots: `fox-default.png`, `fox-frosted.png`.
- The Washington Post — blocked, not passed. Headless navigation repeatedly returned `net::ERR_HTTP2_PROTOCOL_ERROR`. Screenshot: `washington-post-default.png` shows Chrome's `This site can't be reached` page and exact error.
- The Wall Street Journal — blocked, not passed. The site returned `Access is temporarily restricted`. Screenshot: `wsj-default.png`.

The pass-site screenshots were inspected: default news pages were visible, and frosted screenshots showed the light translucent blur, one centered reveal cue, and no dark smudge or duplicate layer.

## Package checks

- Rebuilt `dist` immediately before packaging.
- Recreated `goggles-0.2.0.zip` from the contents of `dist` through a temporary archive and atomic replacement.
- `unzip -t goggles-0.2.0.zip` — no errors.
- ZIP contains 24 entries, with `manifest.json` at root and no `dist/` prefix.
- Removed provider assets are absent.
- Package/source/root manifests are version `0.2.0`, request only `storage` and `activeTab`, and contain no provider/declarative rule contract.
- SHA-256: `d9fa3caa4df678357c2a796c9409aed1bdb0148929f91a790171bbcb694787d1`.

## Commit

- Release unit: `9d608d284e7a73f288760e8773bfaaf8e5edf03f` (`release: package Goggles v0.2.0`).
- Report evidence: committed immediately after this file was written.

## Self-review

- The implementation remains within GitHub issue #1: no subject matching, descriptions, classifier thresholds, or frost appearance were changed.
- The only production behavior fix is the packaged Settings sender path; its extension-ID/origin/path boundary remains exact and supports both documented unpacked layouts.
- Deterministic E2E now encodes explicit protection for non-social loopback fixtures and verifies the new default-policy journeys rather than relying on the removed global default.
- Video assertions compare native playback identity/state and provider URL/autoplay across frost transitions; built artifacts contain no playback or network interception.
- README and privacy copy cover the eight controls, social-only ordinary defaults, exact-origin manual rules, contextual actions, independent subjects, and visual-only video without the removed interception claims.

## Concerns

- Washington Post remains unverified beyond the captured HTTP/2 navigation blocker.
- WSJ remains unverified beyond its captured temporary access restriction.

## Final subject-work integration and bounded browser retry

- Layered the existing multi-subject/name-suggestion changes from the primary worktree onto the release branch without changing the primary worktree.
- Removed the obsolete static-only Settings screenshot test; the loaded-extension Settings visual test already exercises the dynamically generated matching-word editor.
- Fresh integrated verification: typecheck and build passed; 20 unit files / 240 tests passed; 38 deterministic loaded-extension E2E passed and 6 opt-in live tests skipped.
- Rebuilt `goggles-0.2.0.zip`; `unzip -t` passed, `manifest.json` remains at archive root, and removed provider assets remain absent. Final SHA-256: `0c1d3eee0e135bfdc5b291000daab5de254fdaf2e56b826281e5bc98ea37b60e`.
- One alternate-method retry used the user's Chrome: Washington Post loaded normally, proving the prior HTTP/2 error was isolated-headless specific. WSJ reached a human-verification slider and remains blocked; it was not solved or bypassed.
- Camofox was not installed or exposed on this machine, so no Camofox result is claimed.
