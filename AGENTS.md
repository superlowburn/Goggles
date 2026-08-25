# Goggles working agreements

## Visual QA gate

Before returning any user-visible code change:

- Run fresh visual QA on Reddit, CNN, The New York Times, Fox News, The Washington Post, and The Wall Street Journal.
- Inspect protected images and videos, reveal behavior, description and goggles menus, duplicate overlays, and control placement.
- Double-check every frost/unfrost transition: individual reveal, reveal-all, site allow and re-frost, Strict mode, Blocked Subjects on allowed sites, reload/navigation, dynamic media, and image/video/link isolation.
- Capture and inspect screenshots from every site.
- If login, a paywall, or anti-bot protection blocks a site, name the blocker and do not claim that site passed.

## Browser testing safety — hard rule

- Automated browser QA should be truly headless whenever the extension can load that way.
- Never focus, type in, or otherwise interact with the user's browser address bar.
- Do not use Playwright's ordinary headed launch for extension QA; it can activate Chrome and steal the user's focus.
- When Chrome will not load the extension headlessly, the approved fallback is an isolated Chrome process started directly with a temporary user-data directory, a remote-debugging port, `--no-startup-window`, and the unpacked extension flags. Attach Playwright over CDP, then create each 480×320 test window through `Target.createTarget` with `newWindow: true` and `background: true`. Do not use `open`, AppleScript, or Playwright's ordinary `newPage()` to create the first window.
- Record the foreground application before and after with the read-only `lsappinfo` command. Continue only when it is unchanged; otherwise close the QA browser, restore the prior application, and report the check as blocked.

## Push packaging — hard rule

- Before every push, rebuild the extension and recreate the versioned `goggles-<version>.zip` from the contents of `dist`.
- Verify the ZIP with `unzip -t` and include it in the same push, even when the source change is documentation-only.
- The ZIP must contain `manifest.json` at its root so users can unzip it and load that folder directly in Chrome.
