# Subject-first Goggles design

## Product model

Goggles has two independent protections:

1. General site frosting controls ordinary visual media.
2. Blocked subjects always remain frosted, including on sites where general frosting is off.

A user may still deliberately reveal one blocked item. Site-wide permission and page-wide actions must never bypass a blocked-subject match.

## Popup

The popup contains one live site switch: **Frost ordinary media on {hostname}**.

- On: images and videos stay frosted until individually revealed.
- Off: ordinary media shows normally; blocked subjects stay frosted.

Below the switch, show **Blocked subjects** with status **On everywhere** or **Off**, then one **Settings** link. Remove mode cards and all Trusted, Protected, and Strict terminology.

## Protected media

The entire frost surface reveals one item. A small **Show** affordance appears on hover or keyboard focus. Keep the description control only when the target is large enough. Matching media may show a quiet **Blocked subject** reason label when space permits.

Remove the per-item goggles menu, reveal-all action, site-permission action, and floating allowed-site control. After reveal, show at most one anchored **Frost again** control.

## Settings

Settings has two main sections:

1. **Blocked subjects** — “Always frost likely matches, on every site.” Each subject has a toggle and an expandable matching-word editor.
2. **Sites showing ordinary media** — “Blocked subjects still stay frosted on these sites.” Each exception offers **Frost ordinary media again**.

Remove the default-mode section. New sites are protected by definition. Keep the compact Goggles header and local-processing privacy note.

## Detection scope

Subject matching uses local page evidence: descriptions, captions, filenames, nearby headings, links, and video titles or posters. It does not identify faces or analyze video frames. Misses and false positives remain possible and are disclosed in settings.

## Policy behavior

The existing site-policy and blocked-subject stores remain independent. Internal trusted/protected values may remain implementation details.

The effective decision is:

`protect = general site frosting is on OR candidate matches a blocked subject`

Changing a site or subject rule must reconcile current records in place. It must not clear all layers and rescan in a way that briefly exposes blocked media. Existing Strict values are migrated to ordinary protected behavior.

## Live behavior

- Popup site changes apply to the open page without refresh.
- Subject toggles and keyword edits apply to open pages without refresh.
- Turning general frosting off removes ordinary layers and preserves exactly one layer on each blocked match.
- Turning it on restores ordinary layers without duplicating blocked-subject layers.
- Dynamic media uses the current combined policy.

## Acceptance criteria

- The popup presents one hostname-specific switch and clearly states that blocked subjects still apply.
- Protected to allowed and allowed to protected transitions happen live without duplicate roots or exposure flashes.
- Subject settings update live on allowed sites.
- Linked Reddit media reveals without navigation.
- Reddit thumbnails, lightboxes, and video/poster stacks have one layer and one-click reveal.
- Blocked-subject status is textual, not color-only.
- Keyboard activation, focus indication, accessible names, and error rollback work.
- Desktop and compact popup/settings screenshots receive a visual and design review after implementation.
- Fresh QA covers Reddit, CNN, NYT, Fox News, Washington Post, and Wall Street Journal; access blockers are reported explicitly.
