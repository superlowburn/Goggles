import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { seedProtectedOrigin } from "./extension-storage";

const extensionPath = resolve("dist");

// Regression: Reddit lightboxes received duplicate frost and on-media controls.
// Found by live Reddit QA on 2026-08-20.
test("gives an overlapping Reddit lightbox stack one visible control set", async () => {
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
    await seedProtectedOrigin(context, "http://127.0.0.1:4173");
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/reddit-lightbox.html");

    await expect(page.locator("[data-eclipse-goggles-protected]")).toHaveCount(1);
    await expect(page.locator(".foreground")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.locator(".backdrop")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.getByRole("button", { name: "Show description" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Reveal protected media/u })).toHaveCount(1);
    await expect(page.locator("[data-eclipse-goggles-root] .eg-layer.eg-frost")).toHaveCount(1);
    await expect(page.locator("[data-eclipse-goggles-root] .eg-goggles-control")).toHaveCount(0);
    await expect(page.locator("[data-eclipse-goggles-root] .eg-menu")).toHaveCount(0);

    await page.getByRole("button", { name: /Reveal protected media/ }).click();
    await expect(page.locator("[data-eclipse-goggles-root] .eg-frost")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Frost again" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Always show images here" })).toHaveCount(1);
  } finally {
    await context.close();
  }
});
