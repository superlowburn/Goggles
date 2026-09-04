# Goggles

**The Goggles, they do something.**

Goggles protects your eyes and mind by frosting images and videos on social platforms—think AI gore, jump scares, rage bait, the works. Click the frost to show an image or video.

Frost other sites when you choose, show media on a social platform when you choose, and block image subjects—like THE ORANGE ONE. /shudder

Less eye bleach for everyone!

## What it does

- Frosts meaningful images and videos by default on Facebook, Instagram, Reddit, X/Twitter, TikTok, Threads, Bluesky, and YouTube.
- Shows ordinary media by default on other sites.
- Reveals one item when you click its frosting.
- Adds contextual **Always frost images here** and **Always show images here** controls to eligible media.
- Keeps one shared preference for each supported social platform, optional per-subreddit exceptions, and exact-origin rules for manually frosted non-social sites.
- Can keep likely images of selected subjects frosted even on sites where ordinary media is shown.
- Shows available image descriptions without revealing the image.
- Frosts eligible native videos and recognized YouTube and Vimeo frames visually without changing playback, sound, timing, source URLs, autoplay parameters, or provider loading.
- Stores settings locally and does not upload images, page text, or browsing activity.

Blocked-subject matching uses descriptions, filenames, captions, links, and nearby titles. It is deliberately a best-effort feature: Goggles may miss an image or frost an unrelated one.

## Author's statement

> I made Goggles because I hate exaggerated AI images, AI-manufactured attention-grabbing rage bait, and all the other nonsense I am exposed to the moment I open Reddit or another social network. I also hated seeing Trump's big, orange, dumb face everywhere. I wanted the choice to look instead of having every image forced on me.

## Install from GitHub

Goggles is not yet available in the Chrome Web Store. You can install it manually in Chrome.

### Download a packaged release

When a packaged release is available, download `goggles-<version>.zip` from the [Releases page](https://github.com/superlowburn/Goggles/releases), unzip it, and use the resulting folder in the Chrome steps below.

Do not use GitHub's automatically generated **Source code (zip)** as the extension package. It contains the source but not the built extension.

### Build from the repository

You need [Node.js 22 or newer](https://nodejs.org/).

Using Git:

```sh
git clone https://github.com/superlowburn/Goggles.git
cd Goggles
npm install
npm run build
```

Or choose **Code → Download ZIP** on GitHub, unzip the source, open that folder in Terminal, and run:

```sh
npm install
npm run build
```

### Load Goggles in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's `dist` folder.
5. Pin Goggles from Chrome's Extensions menu if you want its site control to remain visible.

After pulling a newer version from GitHub, run `npm install` and `npm run build` again, then click **Reload** on the Goggles card in `chrome://extensions`.

## Using Goggles

- Click a frosted image or video to reveal that item.
- Click **Frost again** to cover a revealed item again.
- On a visible non-social page, hover or focus the contextual control on sufficiently large media and choose **Always frost images here**. This saves an exact-origin rule for that site.
- After revealing an item on a protected page, choose **Always show images here** when offered to show ordinary current and future media. On Reddit, use the toolbar instead; elsewhere the contextual action changes that social platform's shared preference or the exact non-social origin.
- Click the Goggles toolbar icon to turn ordinary-media frosting on or off for the current site or social platform.
- On an `r/name` page, use the toolbar switch to override Reddit for that subreddit. Choose **Use Reddit setting** to remove the exception and inherit Reddit again.
- Open **Settings** to configure blocked subjects, switch each of the eight social platforms independently, remove subreddit exceptions, and remove manually frosted non-social origins.
- Use the small information control on sufficiently large media to read its available description.

Site and social-platform preferences never override enabled blocked subjects. A likely blocked-subject match stays frosted until you deliberately reveal that item.

Subreddit preferences apply only to that community. Their order is: subreddit exception, Reddit-wide setting, then Goggles' protected social default.

## Development

```sh
npm install
npm run build
npm run verify
```

`npm run verify` runs TypeScript checks, unit tests, a production build, and the loaded-extension Playwright suite.

The production extension is built into `dist/`. Load that folder in Chrome while developing.
