import { chromium, expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { dismissFirstRun, extensionWorker } from "./extension-storage";

const runLiveQa = process.env.GOGGLES_LIVE_VIDEO_QA === "1";
const extensionPath = resolve("dist");
const screenshotDir = resolve(".gstack/qa-reports/screenshots/v0.2");
const providerUrl = "https://www.youtube.com/embed/goggles-v02-qa?autoplay=1&start=12";
const protectedAttribute = "data-eclipse-goggles-protected";

const sites = [
  { name: "Reddit", slug: "reddit", social: true, url: "https://www.reddit.com/" },
  { name: "CNN", slug: "cnn", social: false, url: "https://www.cnn.com/" },
  { name: "The New York Times", slug: "nyt", social: false, url: "https://www.nytimes.com/" },
  { name: "Fox News", slug: "fox", social: false, url: "https://www.foxnews.com/" },
  {
    name: "The Washington Post",
    slug: "washington-post",
    social: false,
    url: "https://www.washingtonpost.com/",
  },
  { name: "The Wall Street Journal", slug: "wsj", social: false, url: "https://www.wsj.com/" },
] as const;

type VideoState = {
  autoplay: boolean;
  currentTime: number;
  hasOwnPlay: boolean;
  muted: boolean;
  paused: boolean;
  playbackRate: number;
  src: string | null;
  srcObjectId: string | undefined;
  volume: number;
};

test.describe("v0.2 live-site visual QA", () => {
  test.skip(!runLiveQa, "Set GOGGLES_LIVE_VIDEO_QA=1 to run public-site acceptance tests.");
  test.describe.configure({ timeout: 120_000 });

  for (const site of sites) {
    test(`${site.name}: defaults, contextual controls, subjects, and visual-only video`, async () => {
      await mkdir(screenshotDir, { recursive: true });
      const context = await launchExtension();
      const extensionErrors: string[] = [];

      try {
        const worker = await extensionWorker(context);
        await dismissFirstRun(context);
        const page = await context.newPage();
        page.on("pageerror", (error) => {
          if (/chrome-extension:\/\/|^Goggles:/u.test(error.message)) extensionErrors.push(error.message);
        });
        page.on("console", (message) => {
          if (message.type() === "error" && /chrome-extension:\/\/|^Goggles:/u.test(message.text())) {
            extensionErrors.push(message.text());
          }
        });

        const navigation = await navigate(page, site.url);
        await page.waitForTimeout(3_000);
        if (site.slug === "cnn") await dismissCnnCookieConsent(page);
        const blocker = await accessBlocker(page, navigation.response?.status(), navigation.error);
        await page.screenshot({
          path: resolve(screenshotDir, `${site.slug}-default.png`),
          fullPage: false,
        });
        test.skip(Boolean(blocker), blocker ?? undefined);

        if (site.social) {
          await expect.poll(() => page.locator(`[${protectedAttribute}]`).count()).toBeGreaterThan(0);
        } else {
          await expect(page.locator(`[${protectedAttribute}]`)).toHaveCount(0);
        }

        await installQaMedia(page);
        const image = page.locator("#goggles-v02-image");
        const video = page.locator("#goggles-v02-video");
        const provider = page.locator("#goggles-v02-provider");
        await expect(image).toBeVisible();
        await video.evaluate((node) => (node as HTMLVideoElement).play());
        await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused)).toBe(false);
        const videoBefore = await videoState(video);
        const providerBefore = await provider.getAttribute("src");

        if (!site.social) {
          await expect(image).not.toHaveAttribute(protectedAttribute, "image");
          const alwaysFrost = await alignedButton(page, image, "Always frost images here");
          await alwaysFrost.focus();
          await page.keyboard.press("Enter");
        }

        await expect(image).toHaveAttribute(protectedAttribute, "image");
        await expect(video).toHaveAttribute(protectedAttribute, "video");
        await expect(provider).toHaveAttribute(protectedAttribute, "video");
        await expect.poll(() => overlappingLayers(page, image)).toBe(1);
        await expect.poll(() => overlappingLayers(page, video)).toBe(1);
        await expect.poll(() => overlappingLayers(page, provider)).toBe(1);
        const imageReveal = await alignedButton(page, image, /Reveal protected media:/u);
        await imageReveal.focus();
        await page.screenshot({
          path: resolve(screenshotDir, `${site.slug}-frosted.png`),
          fullPage: false,
        });

        const topUrl = page.url();
        await imageReveal.click();
        await expect(image).not.toHaveAttribute(protectedAttribute, "image");
        expect(page.url()).toBe(topUrl);
        await (await alignedButton(page, image, "Frost again")).click();
        await expect(image).toHaveAttribute(protectedAttribute, "image");
        await (await alignedButton(page, image, /Reveal protected media:/u)).click();
        await (await alignedButton(page, image, "Always show images here")).click();

        await expect(image).not.toHaveAttribute(protectedAttribute, "image");
        await expect(video).not.toHaveAttribute(protectedAttribute, "video");
        await expect(provider).not.toHaveAttribute(protectedAttribute, "video");
        const videoAfter = await videoState(video);
        expect({ ...videoAfter, currentTime: videoBefore.currentTime }).toEqual(videoBefore);
        expect(videoAfter.currentTime).toBeGreaterThanOrEqual(videoBefore.currentTime);
        expect(await provider.getAttribute("src")).toBe(providerBefore);

        await worker.evaluate(() => chrome.storage.local.set({
          "blocked-subjects": {
            enabled: true,
            keywords: ["Goggles blocked subject fixture"],
          },
        }));
        await page.evaluate(() => {
          const subject = document.createElement("img");
          subject.id = "goggles-v02-subject";
          subject.alt = "Goggles blocked subject fixture";
          subject.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='236'%3E%3Crect width='420' height='236' fill='%23b08352'/%3E%3C/svg%3E";
          Object.assign(subject.style, { display: "block", width: "420px", height: "236px" });
          document.querySelector("#goggles-v02-stage")!.append(subject);

          const ordinary = document.createElement("img");
          ordinary.id = "goggles-v02-future";
          ordinary.alt = "Unrelated future media fixture";
          ordinary.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='236'%3E%3Crect width='420' height='236' fill='%236e8c9c'/%3E%3C/svg%3E";
          Object.assign(ordinary.style, { display: "block", width: "420px", height: "236px" });
          document.querySelector("#goggles-v02-stage")!.append(ordinary);
        });
        await expect(page.locator("#goggles-v02-subject")).toHaveAttribute(protectedAttribute, "image");
        await expect(page.locator("#goggles-v02-future")).not.toHaveAttribute(protectedAttribute, "image");
        await expect(page.getByRole("button", { name: /Reveal blocked subject:/u })).toHaveCount(1);
        await expect(page.locator("[data-eclipse-goggles-root] .eg-layer").count()).resolves.toBeGreaterThan(0);

        await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(2_000);
        await expect(page.locator(`[${protectedAttribute}]`)).toHaveCount(0);
        await page.goto(`${site.url}?goggles-v02-navigation=1`, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await page.waitForTimeout(2_000);
        await expect(page.locator(`[${protectedAttribute}]`)).toHaveCount(0);
        expect(extensionErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

async function launchExtension(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 480, height: 320 },
    args: [
      "--window-size=480,320",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  await context.route(providerUrl, (route) => route.fulfill({
    body: "<!doctype html><html><body>Provider fixture</body></html>",
    contentType: "text/html",
  }));
  return context;
}

async function navigate(page: Page, url: string): Promise<{
  error: string | null;
  response: Awaited<ReturnType<Page["goto"]>>;
}> {
  try {
    return {
      error: null,
      response: await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message.split("\n")[0]! : String(error),
      response: null,
    };
  }
}

async function accessBlocker(
  page: Page,
  status?: number,
  navigationError?: string | null,
): Promise<string | null> {
  const text = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).toLowerCase();
  const phrase = [
    "verify you are human",
    "verification required",
    "confirm that you are human",
    "access denied",
    "captcha",
    "our use of cookies and other technologies",
    "subscribe to continue",
    "sign in to continue",
  ].find((candidate) => text.includes(candidate));
  if (navigationError) return `Navigation blocker on ${page.url()}: ${navigationError}`;
  if (status && status >= 400) return `HTTP ${status} blocked ${page.url()}`;
  return phrase ? `Access blocker on ${page.url()}: ${phrase}` : null;
}

async function dismissCnnCookieConsent(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const accept = frame.getByRole("button", { name: /Accept All Cookies/iu }).first();
    if (!await accept.isVisible().catch(() => false)) continue;
    await accept.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    return;
  }
}

async function installQaMedia(page: Page): Promise<void> {
  await page.evaluate((source) => {
    const stage = document.createElement("section");
    stage.id = "goggles-v02-stage";
    Object.assign(stage.style, {
      background: "white",
      color: "black",
      display: "block",
      isolation: "isolate",
      padding: "16px",
      position: "relative",
      width: "452px",
      zIndex: "2147483000",
    });
    const link = document.createElement("a");
    link.href = "/goggles-v02-must-not-navigate";
    const image = document.createElement("img");
    image.id = "goggles-v02-image";
    image.alt = "Goggles linked image fixture";
    image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='236'%3E%3Crect width='420' height='236' fill='%237aa0b8'/%3E%3Ccircle cx='95' cy='118' r='72' fill='%23e56e52'/%3E%3Crect x='195' y='38' width='180' height='160' fill='%23629a65'/%3E%3Ctext x='210' y='128' font-size='30' fill='white'%3EGoggles QA%3C/text%3E%3C/svg%3E";
    link.append(image);
    const video = document.createElement("video");
    video.id = "goggles-v02-video";
    video.autoplay = true;
    video.setAttribute("aria-label", "Goggles native video fixture");
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 9;
    canvas.getContext("2d")!.fillRect(0, 0, 16, 9);
    video.srcObject = canvas.captureStream(2);
    const provider = document.createElement("iframe");
    provider.id = "goggles-v02-provider";
    provider.title = "Goggles provider video fixture";
    provider.src = source;
    for (const media of [image, video, provider]) {
      Object.assign(media.style, {
        border: "0",
        display: "block",
        height: "236px",
        margin: "8px 0",
        maxWidth: "none",
        width: "420px",
      });
    }
    stage.append(link, video, provider);
    document.body.prepend(stage);
    window.scrollTo(0, 0);
  }, providerUrl);
}

async function alignedButton(page: Page, target: Locator, name: string | RegExp): Promise<Locator> {
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("QA target is not visible");
  const buttons = page.getByRole("button", { name });
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (
      x >= targetBox.x && x <= targetBox.x + targetBox.width &&
      y >= targetBox.y && y <= targetBox.y + targetBox.height
    ) return button;
  }
  throw new Error(`No aligned ${String(name)} control found`);
}

async function overlappingLayers(page: Page, target: Locator): Promise<number> {
  const targetBox = await target.boundingBox();
  if (!targetBox) return 0;
  const layers = page.locator("[data-eclipse-goggles-root] .eg-layer.eg-frost");
  let count = 0;
  for (let index = 0; index < await layers.count(); index += 1) {
    const box = await layers.nth(index).boundingBox().catch(() => null);
    if (!box) continue;
    if (
      Math.abs(box.x - targetBox.x) <= 2 &&
      Math.abs(box.width - targetBox.width) <= 2 &&
      Math.abs(box.y + box.height - (targetBox.y + targetBox.height)) <= 2
    ) count += 1;
  }
  return count;
}

async function videoState(video: Locator): Promise<VideoState> {
  return video.evaluate((node) => {
    const media = node as HTMLVideoElement;
    return {
      autoplay: media.autoplay,
      currentTime: media.currentTime,
      hasOwnPlay: Object.hasOwn(media, "play"),
      muted: media.muted,
      paused: media.paused,
      playbackRate: media.playbackRate,
      src: media.getAttribute("src"),
      srcObjectId: media.srcObject instanceof MediaStream ? media.srcObject.id : undefined,
      volume: media.volume,
    };
  });
}
