import { chromium, expect, test, type Locator, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");

type Rect = { bottom: number; height: number; left: number; right: number; top: number };

function overlaps(first: Rect, second: Rect): boolean {
  return first.left < second.right && first.right > second.left &&
    first.top < second.bottom && first.bottom > second.top;
}

async function visibleRect(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return {
    bottom: box!.y + box!.height,
    height: box!.height,
    left: box!.x,
    right: box!.x + box!.width,
    top: box!.y,
  };
}

async function expectNoHorizontalOverflow(page: Page, expectedWidth: number): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.client).toBe(expectedWidth);
  expect(widths.scroll).toBe(widths.client);
}

test("renders the scoped Reddit popup without overlap at 320px and desktop widths", async ({
  page,
}, testInfo) => {
  await page.setContent('<main id="app"></main>');
  await page.addStyleTag({ path: resolve("dist/popup/popup.css") });
  await page.evaluate(() => {
    Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
      tabs: { query: async () => [{ id: 7 }] },
      runtime: {
        openOptionsPage: async () => undefined,
        sendMessage: async () => ({
          origin: "https://www.reddit.com",
          mode: "trusted",
          reddit: {
            canonicalName: "twenty_one_char_name",
            displayName: "Twenty_One_Char_Name",
            inheritedMode: "protected",
            hasOverride: true,
          },
          blockedSubjects: { enabled: true, keywords: ["Donald Trump"] },
        }),
      },
    } });
  });
  await page.addScriptTag({ path: resolve("dist/popup/popup.js") });
  await expect(page.getByRole("switch", { name: /Twenty_One_Char_Name/u })).toBeVisible();

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 420, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page, viewport.width);

    const switchCopy = await visibleRect(page.locator(".popup-switch-copy"));
    const switchControl = await visibleRect(page.locator(".popup-switch-control"));
    const redditState = await visibleRect(page.locator(".popup-reddit-state"));
    const reset = await visibleRect(page.locator(".popup-reset-subreddit"));
    const protectionSwitch = await visibleRect(page.locator(".popup-switch"));
    expect(overlaps(switchCopy, switchControl)).toBe(false);
    expect(overlaps(redditState, reset)).toBe(false);
    expect(protectionSwitch.height).toBeGreaterThanOrEqual(44);
    expect(reset.height).toBeGreaterThanOrEqual(44);
    expect(reset.right).toBeLessThanOrEqual(viewport.width);

    await testInfo.attach(`subreddit-popup-${viewport.width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("renders seeded Settings exceptions without overlap at 320px and desktop widths", async ({},
  testInfo) => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1024, height: 900 },
    args: [
      "--window-size=1024,900",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => chrome.storage.local.set({
      "reddit-subreddit-policy:openai": "protected",
      "reddit-subreddit-display:openai": "OpenAI",
      "reddit-subreddit-policy:twenty_one_char_name": "trusted",
      "reddit-subreddit-display:twenty_one_char_name": "Twenty_One_Char_Name",
    }));
    const optionsUrl = `chrome-extension://${new URL(worker.url()).host}/options/options.html`;
    await expect.poll(() => context.pages().some((candidate) => (
      candidate.url().includes("/options/options.html")
    ))).toBe(true);
    const page = context.pages().find((candidate) => (
      candidate.url().includes("/options/options.html")
    ))!;
    await page.waitForLoadState("domcontentloaded");
    await page.goto(optionsUrl);
    await expect(page.getByRole("heading", { name: "Subreddit exceptions" })).toBeVisible();
    await expect(page.getByText("r/OpenAI", { exact: true })).toBeVisible();

    for (const viewport of [
      { width: 320, height: 900 },
      { width: 1024, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page, viewport.width);

      const rows = page.locator("[data-subreddit-policy]");
      await expect(rows).toHaveCount(2);
      for (let index = 0; index < await rows.count(); index += 1) {
        const row = rows.nth(index);
        const rowRect = await visibleRect(row);
        const nameRect = await visibleRect(row.locator("strong"));
        const stateRect = await visibleRect(row.locator(".subreddit-state"));
        const resetRect = await visibleRect(row.locator("button"));
        expect(overlaps(nameRect, stateRect)).toBe(false);
        expect(overlaps(nameRect, resetRect)).toBe(false);
        expect(overlaps(stateRect, resetRect)).toBe(false);
        expect(resetRect.height).toBeGreaterThanOrEqual(44);
        expect(resetRect.left).toBeGreaterThanOrEqual(rowRect.left);
        expect(resetRect.right).toBeLessThanOrEqual(rowRect.right);
      }

      await testInfo.attach(`subreddit-settings-${viewport.width}px`, {
        body: await page.locator("#subreddit-exceptions").screenshot(),
        contentType: "image/png",
      });
    }
  } finally {
    await context.close();
  }
});
