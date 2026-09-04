# Reddit ad frost fix and subreddit controls

## Outcome

Deliver two changes in order:

1. Stop Goggles from frosting Reddit advertisements and prevent full-text site actions from crowding compact media.
2. Let users override the Reddit-wide frosting setting for an individual subreddit from the toolbar popup.

The work is based on commit `c338fca` in `spec/default-frosting-social-20260825-1248`. Do not mix in the unrelated dirty `feat/responsive-goggles-ux` checkout.

## Confirmed defect

The second frost on the reported r/OpenAI post is a 144 x 144 dbrand advertisement thumbnail. It passes the generic image classifier because it has a non-empty alt attribute and exceeds the image size threshold. After reveal, the existing 96 x 96 site-action threshold adds both `Frost again` and `Always show images here` to the small tile, producing the floating three-line control.

## Product decisions

- Reddit advertisements are not user-requested post media and should not be frosted.
- Detect advertisements through verified Reddit semantic containers or attributes, never ad copy or asset URLs.
- The contextual `Always show/frost images here` action requires a surface of at least 280 x 180. Small media retains the item-level reveal and `Frost again` control.
- Subreddit control lives in the toolbar popup, not on individual media.
- A subreddit preference is an optional override. Precedence is: subreddit override, Reddit-wide setting, protected default.
- Existing users need no migration; absent subreddit rules inherit their current Reddit-wide setting.
- Blocked Subjects remain frosted regardless of a subreddit or Reddit-wide Off setting.

## UX sprint result

On an unambiguous `/r/OpenAI/...` page, the popup shows:

- Context: `Reddit` and `r/OpenAI`.
- Primary switch: `Frost media in r/OpenAI`.
- Inherited state: `On - using your Reddit setting.` or `Off - using your Reddit setting.`
- Override state: `On - frosted in r/OpenAI.` or `Off - media shows normally in r/OpenAI.`
- Quiet reset action when overridden: `Use Reddit setting`.
- Read-only context: `All Reddit: On` or `All Reddit: Off`.
- Blocked Subjects reminder: `Blocked subjects stay frosted here.`

On Reddit home, search, user, and other pages without an unambiguous community, retain the existing `Frost media on Reddit` platform control. Do not infer a subreddit from embedded posts, search filters, or visible copy.

Settings adds a `Subreddit exceptions` section below Social platforms only when at least one override exists. Each row shows the display name, On/Off state, and `Use Reddit setting`. No empty-state panel is needed.

Accessibility requirements:

- Use a real button with `role="switch"`, `aria-checked`, and an accessible name containing the subreddit.
- Maintain a 44 px target, visible focus, disabled/busy save state, and keyboard focus after success or rollback.
- Announce resets and saves politely; failures use an alert.
- Do not communicate state through color alone.
- At 320 px popup width, labels and controls must not overlap or truncate the community name.

## Engineering design

### Policy model

- Parse a community only from verified Reddit hosts and a canonical `/r/<name>` path segment.
- Validate Reddit community syntax and store a canonical lowercase key while preserving display casing from the current URL.
- Add `reddit-subreddit-policy:<canonical-name>` with values `protected` or `trusted`.
- Extend policy resolution to accept the full tab URL for Reddit while preserving existing origin-based behavior elsewhere.
- Extend `PolicyContext` with the Reddit scope, inherited Reddit mode, and whether an override exists.
- Add validated get, set, and reset message contracts for the current tab context.
- On writes, the service worker must re-read the tab URL and compare the expected subreddit. Origin-only validation cannot prevent a stale popup write after Reddit SPA navigation.

### Live navigation

- Use the extension's existing `webNavigation` capability to handle Reddit history-state navigation.
- On a subreddit path change, recompute policy and send a narrow internal policy update to the top-frame content script.
- Rebind storage watchers from the previous subreddit key to the new key, then call `controller.applyMode`.
- Full document navigations continue to initialize normally.

### Immediate defect fix

- In `src/media/classifier.ts`, reject media within verified Reddit advertisement containers before video, iframe, image, or background-image classification.
- Cover the observed `shreddit-dynamic-ad-link` thumbnail and verified promoted/ad post containers without globally excluding advertising across other sites.
- In `src/protection/renderer.ts`, change site-action eligibility to 280 x 180 while leaving item reveal/re-frost available on smaller media.

## Delivery workstreams

### 1. Reddit defect patch

- Add the narrow Reddit-ad exclusion.
- Raise contextual site-action eligibility.
- Add classifier and renderer boundary unit tests.
- Add a Reddit fixture containing ordinary post media, a promoted thumbnail, and a promoted video; assert only ordinary media is frosted.
- Run targeted tests, then `npm run verify`.

### 2. Policy foundation

- Add and test the Reddit URL/community parser.
- Add subreddit key, precedence, inheritance, reset, and watcher behavior to the policy store.
- Extend shared message and context types.
- Add service-worker validation and stale-route rejection tests.

### 3. Runtime behavior

- Return URL-aware policy contexts for popup and content callers.
- Recompute policy on Reddit SPA transitions and rebind the active watcher.
- Test r/A to r/B, r/A to home, back/forward, reload, and dynamic media inserted after navigation.

### 4. Popup and Settings

- Implement the approved scoped popup journey and copy.
- Add optimistic save with rollback, route-change error, explicit inheritance reset, and focus preservation.
- Add the non-empty subreddit-exceptions list to Settings.
- Add unit and static visual tests at desktop and 320 px widths.

### 5. Integrated acceptance

- Reddit-wide On, r/A Off, r/B inherited On.
- Changing Reddit-wide mode updates inheriting subreddits but not explicit overrides.
- Reset immediately adopts the Reddit-wide mode.
- Blocked Subjects stays frosted in an Off subreddit.
- Individual reveal/re-frost still works.
- Reddit advertisements produce no frost or Goggles controls.
- Same-document navigation applies the destination policy without reload.
- Preferences persist across browser restart.

### 6. Release gate

- Run fresh Chrome visual QA on Reddit, CNN, The New York Times, Fox News, The Washington Post, and The Wall Street Journal.
- Inspect protected images/videos, descriptions, duplicate layers, control placement, individual reveal, reveal-all if present, site allow/re-frost, Strict mode, Blocked Subjects, reload/navigation, and dynamic media.
- Capture screenshots for every site and name any login, paywall, or anti-bot blocker rather than claiming a pass.
- Update README usage and precedence/reset documentation.
- Bump the extension version consistently, build `dist`, recreate `goggles-<version>.zip` from `dist`, verify `manifest.json` is at the ZIP root, and run `unzip -t`.
- Commit source, tests, docs, built package, and versioned ZIP together; push and update the existing delivery PR or open the designated release PR.

## Recommended sequencing and ownership

1. Engineer A: defect patch and regressions.
2. Engineer B: policy parser/store/contracts after the UX semantics are accepted.
3. Engineer C: popup/Settings implementation after the policy contract lands.
4. Integration owner: SPA navigation, cross-track integration, full verification, visual QA, packaging, and PR delivery.

The defect patch can ship independently if the subreddit feature requires another iteration. The policy, runtime, and UI work should land in that dependency order rather than being developed as competing storage implementations.

## Not in scope

- Per-post, per-user, or per-feed rules.
- Cloud sync or browsing-history upload.
- Automatic subreddit discovery from page text.
- A subreddit management dashboard beyond the compact exceptions list.
- Broad cross-site advertisement detection.

## Approval gate

Default recommendation: approve the popup-based subreddit override, explicit `Use Reddit setting` reset, and ad exclusion. The only meaningful taste alternative is whether subreddit exceptions should also appear in Settings; this plan includes them because otherwise users cannot discover and remove old exceptions away from the subreddit.
