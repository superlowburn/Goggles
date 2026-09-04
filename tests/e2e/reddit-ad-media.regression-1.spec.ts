import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { seedProtectedOrigin } from "./extension-storage";

const extensionPath = resolve("dist");
const fixturePath = resolve("tests/e2e/fixtures/reddit-ad-media.html");
const redditFixtureUrl = "https://www.reddit.com/goggles-e2e/reddit-ad-media.html";

// Regression: a 144px promoted thumbnail on Reddit received frost and a crowded site action.
test("protects ordinary Reddit media but excludes semantic advertisement media", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 427, height: 240 },
    args: [
      "--window-size=427,240",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await context.route(redditFixtureUrl, (route) => route.fulfill({
      path: fixturePath,
      contentType: "text/html",
    }));
    await seedProtectedOrigin(context, "https://www.reddit.com");
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(redditFixtureUrl);

    await expect(page.locator("#ordinary-media")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.locator("#dynamic-ad-thumbnail")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
    );
    await expect(page.locator("#promoted-video")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
    );
    await expect(page.locator("#promoted-post-image")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
    );
    await expect(page.locator("[data-eclipse-goggles-root]")).toHaveCount(1);
  } finally {
    await context.close();
  }
});
